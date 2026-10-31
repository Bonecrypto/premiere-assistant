import { fromApiToolName, toApiToolName, type ToolDef } from "@pa/core";
import { config } from "../config.ts";
import type { ChatProvider, Conversation, StepResult, ToolCall, ToolCallResult } from "./types.ts";

/**
 * Модели с API в формате OpenAI Chat Completions: OpenRouter (бесплатные модели по ключу)
 * и Ollama (локальная модель на компьютере, без ключа). Обычный fetch + SSE, без зависимостей.
 */

type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ApiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ApiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface Chunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string; code?: number | string };
}

export class CompatApiError extends Error {
  constructor(
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

class CompatAbortError extends Error {}

interface Flavor {
  id: "openrouter" | "ollama";
  title: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyVar: string;
  apiKeyConfigured: boolean;
  /** Модели по порядку (для OpenRouter — запасные на случай лимитов). Пустой список — выбрать автоматически. */
  models: string[];
}

export function createOpenRouterProvider(): ChatProvider {
  const flavor: Flavor = {
    id: "openrouter",
    title: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY?.trim(),
    apiKeyVar: "OPENROUTER_API_KEY",
    apiKeyConfigured: config.openrouter.apiKeyConfigured,
    models: config.openrouter.models,
  };
  return makeProvider(flavor);
}

export function createOllamaProvider(): ChatProvider {
  const flavor: Flavor = {
    id: "ollama",
    title: "Ollama",
    baseUrl: `${config.ollama.url.replace(/\/$/, "")}/v1`,
    apiKeyVar: "(ключ не нужен)",
    apiKeyConfigured: true,
    models: [config.ollama.model],
  };
  return makeProvider(flavor);
}

function makeProvider(flavor: Flavor): ChatProvider {
  const provider: ChatProvider = {
    id: flavor.id,
    title: flavor.title,
    model: flavor.models[0] ?? "бесплатная (выбор автоматически)",
    apiKeyConfigured: flavor.apiKeyConfigured,
    apiKeyVar: flavor.apiKeyVar,
    createConversation: (systemPrompt) => new CompatConversation(flavor, systemPrompt, provider),
    isAbort: (err) => err instanceof CompatAbortError || (err as Error)?.name === "AbortError",
    describeError: (err) => describeError(flavor, err),
  };
  return provider;
}

/** Проверка при запуске: что модель доступна. Возвращает строку для лога. */
export async function checkCompatSetup(provider: ChatProvider): Promise<string | null> {
  if (provider.id === "ollama") {
    const url = config.ollama.url.replace(/\/$/, "");
    try {
      const res = await fetch(`${url}/api/tags`);
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const names = (data.models ?? []).map((m) => m.name);
      const want = config.ollama.model;
      const found = names.some((n) => n === want || n === `${want}:latest` || n.split(":")[0] === want);
      if (!found) {
        return `⚠ Модель ${want} не скачана. Выполните в терминале: ollama pull ${want}` +
          (names.length ? `\n  Уже скачаны: ${names.join(", ")}` : "");
      }
      return null;
    } catch {
      return `⚠ Ollama не отвечает на ${url}. Установите Ollama (ollama.com) и запустите её.`;
    }
  }
  if (provider.id === "openrouter" && provider.apiKeyConfigured && config.openrouter.models.length === 0) {
    try {
      const models = await pickFreeModels();
      if (models.length === 0) return "⚠ Не нашёл бесплатных моделей с инструментами на OpenRouter. Укажите OPENROUTER_MODEL в .env.";
      config.openrouter.models.push(...models);
      provider.model = models[0];
      return `Бесплатные модели OpenRouter: ${models.join(", ")}`;
    } catch (err) {
      return `⚠ Не удалось получить список моделей OpenRouter: ${(err as Error).message}`;
    }
  }
  return null;
}

/** Бесплатные модели OpenRouter, которые умеют вызывать инструменты; сначала — известные сильные семейства. */
async function pickFreeModels(): Promise<string[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    data: Array<{ id: string; context_length?: number; supported_parameters?: string[] }>;
  };
  const free = data.data.filter((m) => m.id.endsWith(":free") && (m.supported_parameters ?? []).includes("tools"));
  const preferred = ["deepseek", "qwen", "gemini", "llama", "mistral", "glm", "kimi", "gpt-oss"];
  const rank = (id: string) => {
    const i = preferred.findIndex((p) => id.toLowerCase().includes(p));
    return i === -1 ? preferred.length : i;
  };
  free.sort((a, b) => rank(a.id) - rank(b.id) || (b.context_length ?? 0) - (a.context_length ?? 0));
  // OpenRouter принимает до 3 моделей: если первая занята или упёрлась в лимит, отвечает следующая.
  return free.slice(0, 3).map((m) => m.id);
}

function describeError(flavor: Flavor, err: unknown): string {
  if (err instanceof CompatApiError) {
    const m = err.message;
    if (flavor.id === "ollama") {
      if (err.httpStatus === 404) return `Модель ${config.ollama.model} не найдена в Ollama. Выполните: ollama pull ${config.ollama.model}`;
      if (/does not support tools/i.test(m)) {
        return `Модель ${config.ollama.model} не умеет вызывать инструменты. Возьмите другую, например qwen3:8b (OLLAMA_MODEL в .env).`;
      }
      return `Ollama вернула ошибку (${err.httpStatus}): ${m}`;
    }
    if (err.httpStatus === 401) return "Неверный OPENROUTER_API_KEY. Создайте ключ заново на openrouter.ai/keys и перезапустите помощника.";
    if (err.httpStatus === 402) return "OpenRouter просит пополнить баланс: выбранная модель не бесплатная. Уберите OPENROUTER_MODEL из .env — помощник сам выберет бесплатные.";
    if (err.httpStatus === 429) return "Достигнут лимит бесплатных запросов OpenRouter. Подождите немного (дневной лимит обновляется раз в сутки).";
    if (/data policy|privacy/i.test(m)) {
      return "OpenRouter не даёт бесплатные модели из-за настроек приватности. Откройте openrouter.ai/settings/privacy и разрешите бесплатные модели (Free model publication / training), затем повторите.";
    }
    if (err.httpStatus === 404) return `Модель не найдена на OpenRouter: ${m}. Уберите OPENROUTER_MODEL из .env — помощник выберет сам.`;
    if (err.httpStatus >= 500) return "Сервис OpenRouter временно недоступен. Повторите через минуту.";
    return `OpenRouter отклонил запрос (${err.httpStatus}): ${m}`;
  }
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
    return flavor.id === "ollama"
      ? `Ollama не отвечает (${config.ollama.url}). Запустите приложение Ollama и повторите.`
      : "Нет связи с OpenRouter. Проверьте интернет.";
  }
  return `Внутренняя ошибка помощника: ${(err as Error)?.message || String(err)}`;
}

class CompatConversation implements Conversation {
  private history: Msg[] = [];

  constructor(
    private readonly flavor: Flavor,
    private readonly systemPrompt: string,
    private readonly provider: ChatProvider,
  ) {}

  addUserText(text: string): void {
    this.history.push({ role: "user", content: text });
  }

  async step(tools: ToolDef[], onText: (delta: string) => void, signal: AbortSignal): Promise<StepResult> {
    const models = this.flavor.models;
    if (models.length === 0 && this.flavor.id === "openrouter") {
      // При запуске список не загрузился — пробуем ещё раз.
      models.push(...(await pickFreeModels().catch(() => [])));
      if (models[0]) this.provider.model = models[0];
    }
    if (models.length === 0) {
      throw new CompatApiError(404, "не выбрана модель (OPENROUTER_MODEL пуст, автовыбор не удался)");
    }
    const body: Record<string, unknown> = {
      messages: [{ role: "system", content: this.systemPrompt }, ...this.history],
      tools: tools.map((t) => ({
        type: "function",
        function: { name: toApiToolName(t.name), description: t.description, parameters: t.inputSchema },
      })),
      stream: true,
      max_tokens: 8192,
    };
    if (this.flavor.id === "openrouter" && models.length > 1) body.models = models;
    else body.model = models[0];

    const res = await this.request(body, signal);

    let text = "";
    let finish = "";
    const calls: Array<{ id: string; name: string; args: string }> = [];
    const think = new ThinkFilter(onText);

    for await (const chunk of readSse(res, signal)) {
      if (chunk.error) {
        const code = typeof chunk.error.code === "number" ? chunk.error.code : 500;
        throw new CompatApiError(code, chunk.error.message ?? "ошибка");
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      const d = choice.delta;
      if (d?.content) {
        text += d.content;
        think.push(d.content);
      }
      for (const tc of d?.tool_calls ?? []) {
        const i = tc.index ?? calls.length;
        calls[i] ??= { id: "", name: "", args: "" };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].name += tc.function.name;
        if (tc.function?.arguments) calls[i].args += tc.function.arguments;
      }
    }
    // Модель выбирается на стороне OpenRouter — показываем, какая ответила.
    if (res.headers.get("x-model") && this.flavor.id === "openrouter") this.provider.model = res.headers.get("x-model")!;

    if (finish === "content_filter") return { stop: "refusal", toolCalls: [] };

    const apiCalls: ApiToolCall[] = calls
      .filter((c) => c && c.name)
      .map((c, i) => ({
        id: c.id || `call_${Date.now().toString(36)}_${i}`,
        type: "function" as const,
        function: { name: c.name, arguments: c.args || "{}" },
      }));

    this.history.push({
      role: "assistant",
      content: stripThink(text) || null,
      ...(apiCalls.length ? { tool_calls: apiCalls } : {}),
    });

    const toolCalls: ToolCall[] = apiCalls.map((c) => ({
      id: c.id,
      name: fromApiToolName(c.function.name),
      input: parseArgs(c.function.arguments),
    }));

    if (finish === "length") return { stop: "max_tokens", toolCalls };
    if (toolCalls.length > 0) return { stop: "tool_calls", toolCalls };
    return { stop: "done", toolCalls: [] };
  }

  addToolResults(results: ToolCallResult[]): void {
    for (const r of results) {
      this.history.push({ role: "tool", tool_call_id: r.call.id, content: r.isError ? `Ошибка: ${r.content}` : r.content });
    }
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

  private async request(body: unknown, signal: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.flavor.apiKey) headers.authorization = `Bearer ${this.flavor.apiKey}`;
    if (this.flavor.id === "openrouter") headers["x-title"] = "Premiere Assistant";
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw new CompatAbortError("aborted");
      let res: Response;
      try {
        res = await fetch(`${this.flavor.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        if (signal.aborted) throw new CompatAbortError("aborted");
        throw err;
      }
      if (res.ok) return res;
      const raw = await res.text();
      let message = raw.slice(0, 500);
      try {
        const j = JSON.parse(raw) as { error?: { message?: string } | string };
        message = typeof j.error === "string" ? j.error : (j.error?.message ?? message);
      } catch {
        /* не JSON */
      }
      if ((res.status === 502 || res.status === 503) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw new CompatApiError(res.status, message);
    }
  }
}

function parseArgs(raw: string): unknown {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    // Невалидный JSON — отдадим как есть, проверка схемы вернёт модели понятную ошибку.
    return { _raw: raw };
  }
}

function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
}

/** Часть локальных моделей пишет рассуждения в <think>…</think> прямо в текст — скрываем их при стриминге. */
class ThinkFilter {
  private buf = "";
  private inside = false;

  constructor(private readonly out: (s: string) => void) {}

  push(s: string): void {
    this.buf += s;
    for (;;) {
      if (this.inside) {
        const end = this.buf.indexOf("</think>");
        if (end === -1) {
          this.buf = this.buf.slice(-8);
          return;
        }
        this.buf = this.buf.slice(end + 8).replace(/^\s+/, "");
        this.inside = false;
      } else {
        const start = this.buf.indexOf("<think>");
        if (start === -1) {
          // Хвост может оказаться началом тега — придержим его.
          const keep = partialTagSuffix(this.buf, "<think>");
          const emit = this.buf.slice(0, this.buf.length - keep);
          if (emit) this.out(emit);
          this.buf = this.buf.slice(this.buf.length - keep);
          return;
        }
        if (start > 0) this.out(this.buf.slice(0, start));
        this.buf = this.buf.slice(start + 7);
        this.inside = true;
      }
    }
  }
}

function partialTagSuffix(s: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) {
    if (tag.startsWith(s.slice(-n))) return n;
  }
  return 0;
}

async function* readSse(res: Response, signal: AbortSignal): AsyncGenerator<Chunk> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (signal.aborted) throw new CompatAbortError("aborted");
        throw err;
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue; // комментарии OpenRouter («: OPENROUTER PROCESSING») пропускаем
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          yield JSON.parse(data) as Chunk;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
