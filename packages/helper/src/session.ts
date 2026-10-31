import Anthropic from "@anthropic-ai/sdk";
import {
  fromApiToolName,
  makeId,
  PROTOCOL_VERSION,
  toApiToolName,
  type HelperToPanel,
  type PanelToHelper,
  type TaskStatus,
  type ToolDef,
  type ToolSpec,
} from "@pa/core";
import { config, HELPER_VERSION } from "./config.ts";
import { checkHostToolSpec, type ToolRegistry } from "./registry.ts";
import { SYSTEM_PROMPT } from "./systemPrompt.ts";
import { validateInput } from "./validate.ts";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;
type ToolUseBlock = Anthropic.Beta.BetaToolUseBlock;

const MAX_RESULT_CHARS = 100_000;

class CancelledError extends Error {
  constructor() {
    super("Отменено пользователем");
  }
}

interface PendingHostCall {
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Одна подключённая панель = одна сессия: история диалога, host-инструменты панели,
 * ожидающие подтверждения и вызовы.
 */
export class Session {
  private history: MessageParam[] = [];
  private registry: ToolRegistry;
  private ready = false;
  private busy = false;
  private abort: AbortController | null = null;
  private pendingConfirms = new Map<string, (approved: boolean) => void>();
  private pendingHostCalls = new Map<string, PendingHostCall>();

  constructor(
    private readonly client: Anthropic,
    baseRegistry: ToolRegistry,
    private readonly sendRaw: (msg: HelperToPanel) => void,
    private readonly log: (text: string) => void,
  ) {
    this.registry = baseRegistry.clone();
  }

  private send(msg: HelperToPanel): void {
    this.sendRaw(msg);
  }

  handle(msg: PanelToHelper): void {
    switch (msg.type) {
      case "hello":
        this.onHello(msg.client, msg.protocolVersion, msg.hostTools ?? []);
        break;
      case "user_message":
        void this.onUserMessage(msg.text);
        break;
      case "confirm_response": {
        const resolve = this.pendingConfirms.get(msg.requestId);
        if (resolve) {
          this.pendingConfirms.delete(msg.requestId);
          resolve(msg.approved === true);
        }
        break;
      }
      case "tool_result": {
        const call = this.pendingHostCalls.get(msg.callId);
        if (call) {
          this.pendingHostCalls.delete(msg.callId);
          clearTimeout(call.timer);
          if (msg.ok) call.resolve(msg.result);
          else call.reject(new Error(msg.error || "Панель вернула ошибку без описания"));
        }
        break;
      }
      case "cancel":
        this.cancel();
        break;
      case "reset":
        if (this.busy) {
          this.send({ type: "error", message: "Сначала остановите текущий ответ, затем начните новый диалог." });
        } else {
          this.history = [];
          this.log("диалог очищен");
        }
        break;
    }
  }

  /** Панель отключилась — освобождаем всё, что ждёт ответа. */
  dispose(): void {
    this.cancel();
  }

  // ───────────── Подключение ─────────────

  private onHello(client: string, protocolVersion: number, hostTools: ToolSpec[]): void {
    if (protocolVersion !== PROTOCOL_VERSION) {
      this.send({
        type: "error",
        message: `Версии протокола не совпадают: панель ${protocolVersion}, помощник ${PROTOCOL_VERSION}. Обновите и пересоберите обе части.`,
      });
    }
    if (this.ready) {
      this.send({ type: "error", message: "Повторное приветствие игнорируется." });
      return;
    }
    for (const spec of hostTools) {
      const problem = checkHostToolSpec(spec);
      if (problem) {
        this.log(`host-инструмент отклонён: ${problem}`);
        continue;
      }
      try {
        this.registry.register(this.makeHostTool(spec));
      } catch (err) {
        this.log(`host-инструмент отклонён: ${(err as Error).message}`);
      }
    }
    this.ready = true;
    const tools = this.registry.list();
    this.log(`клиент "${client}" готов, инструментов: ${tools.length} (${tools.map((t) => t.name).join(", ")})`);
    this.send({
      type: "hello_ack",
      protocolVersion: PROTOCOL_VERSION,
      helperVersion: HELPER_VERSION,
      model: config.model || "(не задана)",
      apiKeyConfigured: config.apiKeyConfigured,
      tools: tools.map(({ name, runsIn, mutates }) => ({ name, runsIn, mutates })),
    });
  }

  /** Обёртка: host-инструмент выполняется в панели, помощник лишь пересылает вызов. */
  private makeHostTool(spec: ToolSpec): ToolDef {
    return {
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
      runsIn: "host",
      mutates: spec.mutates,
      run: (input, ctx) =>
        new Promise((resolve, reject) => {
          const callId = makeId("c_");
          const timer = setTimeout(() => {
            this.pendingHostCalls.delete(callId);
            reject(new Error(`Панель не ответила за ${config.hostToolTimeoutMs / 1000} с`));
          }, config.hostToolTimeoutMs);
          this.pendingHostCalls.set(callId, { resolve, reject, timer });
          ctx.signal.addEventListener(
            "abort",
            () => {
              const call = this.pendingHostCalls.get(callId);
              if (call) {
                this.pendingHostCalls.delete(callId);
                clearTimeout(call.timer);
                call.reject(new CancelledError());
              }
            },
            { once: true },
          );
          this.send({ type: "tool_call", callId, name: spec.name, input });
        }),
    };
  }

  // ───────────── Диалог ─────────────

  private cancel(): void {
    this.abort?.abort();
    for (const resolve of this.pendingConfirms.values()) resolve(false);
    this.pendingConfirms.clear();
    for (const call of this.pendingHostCalls.values()) {
      clearTimeout(call.timer);
      call.reject(new CancelledError());
    }
    this.pendingHostCalls.clear();
  }

  private async onUserMessage(rawText: string): Promise<void> {
    const text = typeof rawText === "string" ? rawText.trim() : "";
    if (!text) return;
    if (!this.ready) {
      this.send({ type: "error", message: "Панель ещё не представилась (hello). Переподключитесь." });
      return;
    }
    if (this.busy) {
      this.send({ type: "error", message: "Ассистент ещё отвечает. Дождитесь ответа или нажмите «Стоп»." });
      return;
    }
    if (!config.apiKeyConfigured) {
      this.send({
        type: "error",
        message: `Не задан ANTHROPIC_API_KEY. Укажите его в ${config.envPath} и перезапустите помощника.`,
      });
      return;
    }
    if (!config.model) {
      this.send({
        type: "error",
        message: `Не задана модель CLAUDE_MODEL. Укажите её в ${config.envPath} и перезапустите помощника.`,
      });
      return;
    }

    this.busy = true;
    const abort = new AbortController();
    this.abort = abort;
    const turnId = makeId("t_");
    const historyStart = this.history.length;
    let stopReason = "end_turn";
    let wroteText = false;

    this.send({ type: "assistant_start", turnId });
    this.history.push({ role: "user", content: text });
    this.log(`→ ${truncate(text, 120)}`);

    const emit = (delta: string) => {
      wroteText = true;
      this.send({ type: "assistant_delta", turnId, text: delta });
    };

    try {
      for (let step = 0; ; step++) {
        if (step >= config.maxAgentSteps) {
          emit(`\n\n_(Остановлено: больше ${config.maxAgentSteps} шагов подряд с инструментами.)_`);
          stopReason = "max_steps";
          break;
        }
        // Абзац между текстом до и после вызова инструментов.
        let separatorPending = step > 0 && wroteText;

        const stream = this.client.beta.messages.stream(this.buildRequest(), { signal: abort.signal });
        stream.on("text", (delta) => {
          if (separatorPending) {
            separatorPending = false;
            emit("\n\n");
          }
          emit(delta);
        });
        const message = await stream.finalMessage();
        stopReason = message.stop_reason ?? "end_turn";

        if (message.stop_reason === "refusal") {
          // Отказ мог оборвать ответ на середине — откатываем весь ход.
          this.history.length = historyStart;
          emit(
            (wroteText ? "\n\n" : "") +
              "Модель отказалась отвечать на этот запрос. Попробуйте переформулировать.",
          );
          break;
        }

        this.history.push({ role: "assistant", content: message.content });

        if (message.stop_reason === "pause_turn") continue;

        const toolUses = message.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
        if (message.stop_reason !== "tool_use" || toolUses.length === 0) {
          if (message.stop_reason === "max_tokens") {
            emit("\n\n_(Ответ обрезан: достигнут лимит длины.)_");
          }
          if (toolUses.length > 0) {
            // Вход инструмента мог оборваться — не выполняем, но история должна оставаться корректной.
            this.history.push({
              role: "user",
              content: toolUses.map((t) => errorResult(t.id, "Вызов не выполнен: ответ модели был обрезан.")),
            });
          }
          break;
        }

        // Все результаты — одним сообщением.
        const results: ToolResult[] = [];
        for (const block of toolUses) {
          results.push(await this.executeTool(block, abort.signal));
        }
        this.history.push({ role: "user", content: results });

        if (abort.signal.aborted) throw new CancelledError();
      }
    } catch (err) {
      if (abort.signal.aborted || err instanceof CancelledError || err instanceof Anthropic.APIUserAbortError) {
        stopReason = "cancelled";
        this.log("ответ остановлен пользователем");
      } else {
        stopReason = "error";
        // Ход не завершился — откатываем его, чтобы история оставалась корректной.
        this.history.length = historyStart;
        const message = describeApiError(err);
        this.log(`✖ ${message}`);
        this.send({ type: "error", message });
      }
    } finally {
      this.busy = false;
      this.abort = null;
      this.send({ type: "assistant_end", turnId, stopReason });
    }
  }

  private buildRequest(): Anthropic.Beta.MessageCreateParamsNonStreaming {
    const tools: Anthropic.Beta.BetaToolUnion[] = this.registry.list().map((t) => ({
      name: toApiToolName(t.name),
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    }));
    return {
      model: config.model,
      max_tokens: config.maxTokens,
      system: SYSTEM_PROMPT,
      // Автоматическое кеширование стабильного префикса (инструменты + системный промпт + история).
      cache_control: { type: "ephemeral" },
      tools,
      messages: this.history,
      ...(config.effort ? { output_config: { effort: config.effort } } : {}),
      ...(config.fallbacks
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    };
  }

  private progress(taskId: string, title: string, status: TaskStatus, detail?: string, progress?: number) {
    this.send({ type: "task_progress", taskId, title, status, detail, progress });
  }

  private async executeTool(block: ToolUseBlock, signal: AbortSignal): Promise<ToolResult> {
    const name = fromApiToolName(block.name);
    const tool = this.registry.get(name);
    const taskId = block.id;

    if (signal.aborted) return errorResult(block.id, "Отменено пользователем.");
    if (!tool) return errorResult(block.id, `Инструмент "${name}" не найден.`);

    const input = block.input;
    const invalid = validateInput(tool.inputSchema, input);
    if (invalid) {
      this.progress(taskId, name, "error", `Некорректные параметры: ${invalid}`);
      return errorResult(block.id, `Некорректные параметры: ${invalid}`);
    }

    if (tool.mutates) {
      const summary = safeDescribe(tool, input);
      this.progress(taskId, name, "waiting_confirm", summary);
      const approved = await this.requestConfirm(name, summary, input, signal);
      if (!approved) {
        this.progress(taskId, name, "cancelled", "Пользователь отклонил действие");
        this.log(`✋ ${name}: отклонено`);
        return errorResult(block.id, "Пользователь отклонил это действие. Не повторяй его без новой просьбы.");
      }
    }

    this.progress(taskId, name, "running");
    this.log(`⚙ ${name} ${truncate(JSON.stringify(input), 200)}`);
    try {
      const result = await tool.run(input, {
        signal,
        progress: (detail, p) => this.progress(taskId, name, "running", detail, p),
      });
      this.progress(taskId, name, "done");
      return { type: "tool_result", tool_use_id: block.id, content: stringifyResult(result) };
    } catch (err) {
      if (err instanceof CancelledError || signal.aborted) {
        this.progress(taskId, name, "cancelled", "Отменено");
        return errorResult(block.id, "Отменено пользователем.");
      }
      const message = (err as Error)?.message || String(err);
      this.progress(taskId, name, "error", message);
      this.log(`✖ ${name}: ${message}`);
      return errorResult(block.id, message);
    }
  }

  private requestConfirm(toolName: string, summary: string, input: unknown, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const requestId = makeId("r_");
      this.pendingConfirms.set(requestId, resolve);
      this.send({ type: "confirm_request", requestId, toolName, summary, input });
    });
  }
}

// ───────────── Утилиты ─────────────

function errorResult(toolUseId: string, message: string): ToolResult {
  return { type: "tool_result", tool_use_id: toolUseId, is_error: true, content: message };
}

function safeDescribe(tool: ToolDef, input: unknown): string {
  try {
    return tool.describe?.(input) || `Выполнить «${tool.name}»`;
  } catch {
    return `Выполнить «${tool.name}»`;
  }
}

function stringifyResult(result: unknown): string {
  let text: string;
  if (typeof result === "string") text = result;
  else if (result === undefined) text = "Готово.";
  else text = JSON.stringify(result, null, 2);
  if (text.length > MAX_RESULT_CHARS) {
    text = text.slice(0, MAX_RESULT_CHARS) + `\n…[результат обрезан: показано ${MAX_RESULT_CHARS} из ${text.length} символов]`;
  }
  return text;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Неверный API-ключ (ANTHROPIC_API_KEY). Проверьте .env помощника.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "Нет доступа к модели или функции с этим ключом. Проверьте CLAUDE_MODEL и права ключа.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return `Модель "${config.model}" не найдена. Проверьте CLAUDE_MODEL в .env.`;
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Превышен лимит запросов к API. Подождите немного и повторите.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `API отклонил запрос: ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Нет связи с Anthropic API. Проверьте интернет/прокси.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Ошибка API (${err.status ?? "?"}): ${err.message}`;
  }
  return `Внутренняя ошибка помощника: ${(err as Error)?.message || String(err)}`;
}
