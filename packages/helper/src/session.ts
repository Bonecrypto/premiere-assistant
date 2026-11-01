import {
  makeId,
  PROTOCOL_VERSION,
  type HelperToPanel,
  type PanelToHelper,
  type TaskStatus,
  type ToolDef,
  type ToolSpec,
} from "@pa/core";
import { config, HELPER_VERSION } from "./config.ts";
import type { ChatProvider } from "./providers/index.ts";
import type { Conversation, ToolCall, ToolCallResult } from "./providers/types.ts";
import { checkHostToolSpec, type ToolRegistry } from "./registry.ts";
import { SYSTEM_PROMPT } from "./systemPrompt.ts";
import { validateInput } from "./validate.ts";

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
 * Одна подключённая панель = одна сессия: диалог с моделью, host-инструменты панели,
 * ожидающие подтверждения и вызовы. С какой моделью идёт диалог — решает провайдер.
 */
export class Session {
  private conversation: Conversation;
  private registry: ToolRegistry;
  private ready = false;
  private busy = false;
  private abort: AbortController | null = null;
  private pendingConfirms = new Map<string, (approved: boolean) => void>();
  private pendingHostCalls = new Map<string, PendingHostCall>();

  constructor(
    private readonly provider: ChatProvider,
    baseRegistry: ToolRegistry,
    private readonly send: (msg: HelperToPanel) => void,
    private readonly log: (text: string) => void,
  ) {
    this.registry = baseRegistry.clone();
    this.conversation = provider.createConversation(SYSTEM_PROMPT);
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
          this.conversation.reset();
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
      model: this.provider.model,
      provider: this.provider.title,
      apiKeyVar: this.provider.apiKeyVar,
      apiKeyConfigured: this.provider.apiKeyConfigured,
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
      describe: spec.confirmText ? () => spec.confirmText! : undefined,
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
    if (!this.provider.apiKeyConfigured) {
      this.send({
        type: "error",
        message: `Не задан ${this.provider.apiKeyVar}. Укажите его в ${config.envPath} и перезапустите помощника.`,
      });
      return;
    }

    this.busy = true;
    const abort = new AbortController();
    this.abort = abort;
    const turnId = makeId("t_");
    const conv = this.conversation;
    const turnStart = conv.checkpoint();
    let stopReason = "end_turn";
    let wroteText = false;

    this.send({ type: "assistant_start", turnId });
    conv.addUserText(text);
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
        const result = await conv.step(
          this.registry.list(),
          (delta) => {
            if (separatorPending) {
              separatorPending = false;
              emit("\n\n");
            }
            emit(delta);
          },
          abort.signal,
        );

        if (result.stop === "refusal") {
          stopReason = "refusal";
          // Отказ мог оборвать ответ на середине — откатываем весь ход.
          conv.rollback(turnStart);
          emit((wroteText ? "\n\n" : "") + "Модель отказалась отвечать на этот запрос. Попробуйте переформулировать.");
          break;
        }
        if (result.stop === "continue") continue;
        if (result.stop === "max_tokens") {
          stopReason = "max_tokens";
          emit("\n\n_(Ответ обрезан: достигнут лимит длины.)_");
          if (result.toolCalls.length > 0) {
            // Вход инструмента мог оборваться — не выполняем, но история должна оставаться корректной.
            conv.addToolResults(
              result.toolCalls.map((call) => ({ call, isError: true, content: "Вызов не выполнен: ответ модели был обрезан." })),
            );
          }
          break;
        }
        if (result.stop === "done") break;

        // Инструменты выполняем по очереди (подтверждения — по одному), результаты отдаём разом.
        const results: ToolCallResult[] = [];
        for (const call of result.toolCalls) {
          results.push(await this.executeTool(call, abort.signal));
        }
        conv.addToolResults(results);

        if (abort.signal.aborted) throw new CancelledError();
      }
    } catch (err) {
      if (abort.signal.aborted || err instanceof CancelledError || this.provider.isAbort(err)) {
        stopReason = "cancelled";
        this.log("ответ остановлен пользователем");
      } else {
        stopReason = "error";
        // Ход не завершился — откатываем его, чтобы история оставалась корректной.
        conv.rollback(turnStart);
        const message = this.provider.describeError(err);
        this.log(`✖ ${message}`);
        this.send({ type: "error", message });
      }
    } finally {
      this.busy = false;
      this.abort = null;
      this.send({ type: "assistant_end", turnId, stopReason });
    }
  }

  private progress(taskId: string, title: string, status: TaskStatus, detail?: string, progress?: number) {
    this.send({ type: "task_progress", taskId, title, status, detail, progress });
  }

  private async executeTool(call: ToolCall, signal: AbortSignal): Promise<ToolCallResult> {
    const fail = (content: string): ToolCallResult => ({ call, content, isError: true });
    const { name, input } = call;
    const tool = this.registry.get(name);
    const taskId = call.id;

    if (signal.aborted) return fail("Отменено пользователем.");
    if (!tool) return fail(`Инструмент "${name}" не найден.`);

    const invalid = validateInput(tool.inputSchema, input);
    if (invalid) {
      this.progress(taskId, name, "error", `Некорректные параметры: ${invalid}`);
      return fail(`Некорректные параметры: ${invalid}`);
    }

    if (tool.mutates) {
      const summary = safeDescribe(tool, input);
      this.progress(taskId, name, "waiting_confirm", summary);
      const approved = await this.requestConfirm(name, summary, input, signal);
      if (!approved) {
        this.progress(taskId, name, "cancelled", "Пользователь отклонил действие");
        this.log(`✋ ${name}: отклонено`);
        return fail("Пользователь отклонил это действие. Не повторяй его без новой просьбы.");
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
      return { call, content: stringifyResult(result), isError: false };
    } catch (err) {
      if (err instanceof CancelledError || signal.aborted) {
        this.progress(taskId, name, "cancelled", "Отменено");
        return fail("Отменено пользователем.");
      }
      const message = (err as Error)?.message || String(err);
      this.progress(taskId, name, "error", message);
      this.log(`✖ ${name}: ${message}`);
      return fail(message);
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
