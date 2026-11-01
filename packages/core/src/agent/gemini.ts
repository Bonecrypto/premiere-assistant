import { makeId } from "../protocol.ts";
import { fromApiToolName, toApiToolName, type JSONSchema, type ToolDef } from "../tool.ts";
import { readSse, SseAbortError } from "./sse.ts";
import type { ChatProvider, Conversation, StepResult, ToolCall, ToolCallResult } from "./types.ts";

/**
 * Google Gemini через REST API (есть бесплатный тариф: ключ на aistudio.google.com).
 * Без SDK: обычный fetch + потоковый ответ (SSE), чтобы не добавлять зависимостей.
 * Формат сверен с официальным SDK @google/genai.
 */

interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
  [key: string]: unknown;
}

interface Content {
  role: "user" | "model";
  parts: Part[];
}

interface StreamChunk {
  candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

export class GeminiApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly status: string,
    message: string,
  ) {
    super(message);
  }
}

class GeminiAbortError extends Error {}

export interface GeminiOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  settingsHint?: string;
  apiKeyVar?: string;
}

interface GeminiCfg {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxTokens: number;
  hint: string;
}

export function createGeminiProvider(opts: GeminiOptions): ChatProvider {
  const cfg: GeminiCfg = {
    apiKey: opts.apiKey?.trim() ?? "",
    model: opts.model?.trim() || "gemini-2.5-flash",
    baseUrl: (opts.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/$/, ""),
    maxTokens: opts.maxTokens ?? 8192,
    hint: opts.settingsHint || "настройках",
  };
  return {
    id: "gemini",
    title: "Gemini",
    model: cfg.model,
    apiKeyConfigured: Boolean(cfg.apiKey),
    apiKeyVar: opts.apiKeyVar || "ключ Gemini",
    createConversation: (systemPrompt) => new GeminiConversation(cfg, systemPrompt),
    isAbort: (err) => err instanceof GeminiAbortError || err instanceof SseAbortError || (err as Error)?.name === "AbortError",
    describeError: (err) => describeError(err, cfg),
  };
}

function describeError(err: unknown, cfg: GeminiCfg): string {
  const model = cfg.model;
  if (err instanceof GeminiApiError) {
    if (err.httpStatus === 429 || err.status === "RESOURCE_EXHAUSTED") {
      return "Достигнут лимит бесплатного тарифа Gemini. Подождите минуту (или до завтра, если исчерпан дневной лимит) и повторите.";
    }
    if (/API key not valid|API_KEY_INVALID/i.test(err.message)) {
      return `Неверный ключ Gemini. Скопируйте ключ заново на aistudio.google.com и вставьте его в ${cfg.hint}.`;
    }
    if (err.httpStatus === 404) {
      return `Модель "${model}" не найдена. Проверьте модель в ${cfg.hint} (список моделей — на aistudio.google.com).`;
    }
    if (err.httpStatus === 403) {
      return `Нет доступа: ${err.message}. Возможно, Gemini API недоступен в вашем регионе или ключ ограничен.`;
    }
    if (err.httpStatus >= 500) return "Сервис Gemini временно недоступен. Повторите через минуту.";
    return `Gemini отклонил запрос (${err.httpStatus}): ${err.message}`;
  }
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
    return "Нет связи с Gemini API. Проверьте интернет/прокси.";
  }
  return `Внутренняя ошибка: ${(err as Error)?.message || String(err)}`;
}

/** Схема для Gemini: пустой объект без полей лучше не передавать вовсе. */
function toolDeclaration(tool: ToolDef): Record<string, unknown> {
  const decl: Record<string, unknown> = { name: toApiToolName(tool.name), description: tool.description };
  const schema: JSONSchema = tool.inputSchema;
  if (schema.properties && Object.keys(schema.properties).length > 0) {
    decl.parametersJsonSchema = schema;
  }
  return decl;
}

class GeminiConversation implements Conversation {
  private history: Content[] = [];

  constructor(
    private readonly cfg: GeminiCfg,
    private readonly systemPrompt: string,
  ) {}

  addUserText(text: string): void {
    this.history.push({ role: "user", parts: [{ text }] });
  }

  async step(tools: ToolDef[], onText: (delta: string) => void, signal: AbortSignal): Promise<StepResult> {
    const body = {
      systemInstruction: { parts: [{ text: this.systemPrompt }] },
      contents: this.history,
      tools: tools.length ? [{ functionDeclarations: tools.map(toolDeclaration) }] : undefined,
      generationConfig: { maxOutputTokens: this.cfg.maxTokens },
    };

    const res = await this.request(body, signal);

    // Части ответа сохраняем как есть (включая thoughtSignature) — модели они нужны в следующих запросах.
    const parts: Part[] = [];
    let finishReason = "";
    let blockReason = "";

    for await (const chunk of readSse<StreamChunk>(res, signal)) {
      if (chunk.error) {
        throw new GeminiApiError(chunk.error.code ?? 500, chunk.error.status ?? "", chunk.error.message ?? "ошибка");
      }
      if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
      const cand = chunk.candidates?.[0];
      if (!cand) continue;
      if (cand.finishReason) finishReason = cand.finishReason;
      for (const part of cand.content?.parts ?? []) {
        parts.push(part);
        if (typeof part.text === "string" && !part.thought && part.text) onText(part.text);
      }
    }

    if (blockReason || ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(finishReason)) {
      return { stop: "refusal", toolCalls: [] };
    }

    if (parts.length > 0) this.history.push({ role: "model", parts });

    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall?.name)
      .map((p) => ({
        // Gemini может не прислать id — тогда придумываем свой, а в ответе id не указываем.
        id: p.functionCall!.id || makeId("g_"),
        name: fromApiToolName(p.functionCall!.name!),
        input: p.functionCall!.args ?? {},
        geminiId: p.functionCall!.id,
      }));

    if (finishReason === "MAX_TOKENS") return { stop: "max_tokens", toolCalls };
    if (toolCalls.length > 0) return { stop: "tool_calls", toolCalls };
    if (finishReason === "MALFORMED_FUNCTION_CALL") {
      onText("\n\n_(Модель неправильно оформила вызов инструмента. Попробуйте переформулировать.)_");
    }
    return { stop: "done", toolCalls: [] };
  }

  addToolResults(results: ToolCallResult[]): void {
    this.history.push({
      role: "user",
      parts: results.map((r) => {
        const geminiId = (r.call as ToolCall & { geminiId?: string }).geminiId;
        return {
          functionResponse: {
            ...(geminiId ? { id: geminiId } : {}),
            name: toApiToolName(r.call.name),
            response: r.isError ? { error: r.content } : { output: r.content },
          },
        };
      }),
    });
  }

  checkpoint(): number {
    return this.history.length;
  }

  rollback(to: number): void {
    this.history.length = to;
  }

  reset(): void {
    this.history = [];
  }

  /** Запрос с повтором при временных сбоях сервера (500/503). */
  private async request(body: unknown, signal: AbortSignal): Promise<Response> {
    const url = `${this.cfg.baseUrl}/v1beta/models/${encodeURIComponent(this.cfg.model)}:streamGenerateContent?alt=sse`;
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw new GeminiAbortError("aborted");
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.cfg.apiKey },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        if (signal.aborted) throw new GeminiAbortError("aborted");
        throw err;
      }
      if (res.ok) return res;

      const text = await res.text();
      let status = "";
      let message = text.slice(0, 500);
      try {
        const j = JSON.parse(text) as StreamChunk;
        status = j.error?.status ?? "";
        message = j.error?.message ?? message;
      } catch {
        /* не JSON — оставляем текст */
      }
      if ((res.status === 500 || res.status === 503) && attempt < 2) {
        await sleep(1500 * (attempt + 1), signal);
        continue;
      }
      throw new GeminiApiError(res.status, status, message);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new GeminiAbortError("aborted"));
    }, { once: true });
  });
}
