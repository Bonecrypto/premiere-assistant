import { makeId, type HelperToPanel, type PanelToHelper, type TaskStatus } from "../protocol.ts";
import type { ToolDef } from "../tool.ts";
import { SYSTEM_PROMPT } from "./systemPrompt.ts";
import type { ChatProvider, Conversation, ToolCall, ToolCallResult } from "./types.ts";
import { validateInput } from "./validate.ts";

const MAX_RESULT_CHARS = 100_000;

export class CancelledError extends Error {
  constructor() {
    super("Отменено пользователем");
  }
}

export interface AgentSessionOptions {
  provider: ChatProvider;
  /** Доступные инструменты (могут меняться — например, после подключения панели). */
  tools: () => ToolDef[];
  /** Куда отправлять сообщения для интерфейса (тот же протокол, что у помощника). */
  send: (msg: HelperToPanel) => void;
  log?: (text: string) => void;
  maxSteps?: number;
  /** Где пользователь задаёт ключ — для подсказки в ошибке. */
  settingsHint?: string;
  /** Вызывается при отмене (например, чтобы прервать ожидающие вызовы в панели). */
  onCancel?: () => void;
}

/**
 * Агентный цикл: диалог с моделью, вызовы инструментов, подтверждения, отмена.
 * Общий для помощника (Node) и встроенного режима панели (UXP).
 */
export class AgentSession {
  private conversation: Conversation;
  private busy = false;
  private abort: AbortController | null = null;
  private pendingConfirms = new Map<string, (approved: boolean) => void>();
  private readonly provider: ChatProvider;
  private readonly maxSteps: number;

  constructor(private readonly opts: AgentSessionOptions) {
    this.provider = opts.provider;
    this.maxSteps = opts.maxSteps ?? 25;
    this.conversation = opts.provider.createConversation(SYSTEM_PROMPT);
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** Обрабатывает сообщения интерфейса: user_message, confirm_response, cancel, reset. */
  handle(msg: PanelToHelper): void {
    switch (msg.type) {
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
      case "cancel":
        this.cancel();
        break;
      case "reset":
        if (this.busy) {
          this.opts.send({ type: "error", message: "Сначала остановите текущий ответ, затем начните новый диалог." });
        } else {
          this.conversation.reset();
          this.opts.log?.("диалог очищен");
        }
        break;
      default:
        break;
    }
  }

  dispose(): void {
    this.cancel();
  }

  cancel(): void {
    this.abort?.abort();
    for (const resolve of this.pendingConfirms.values()) resolve(false);
    this.pendingConfirms.clear();
    this.opts.onCancel?.();
  }

  private async onUserMessage(rawText: string): Promise<void> {
    const text = typeof rawText === "string" ? rawText.trim() : "";
    if (!text) return;
    if (this.busy) {
      this.opts.send({ type: "error", message: "Ассистент ещё отвечает. Дождитесь ответа или нажмите «Стоп»." });
      return;
    }
    if (!this.provider.apiKeyConfigured) {
      this.opts.send({
        type: "error",
        message: `Не задан ${this.provider.apiKeyVar}. Укажите его в ${this.opts.settingsHint ?? "настройках"}.`,
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

    this.opts.send({ type: "assistant_start", turnId });
    conv.addUserText(text);
    this.opts.log?.(`→ ${truncate(text, 120)}`);

    const emit = (delta: string) => {
      wroteText = true;
      this.opts.send({ type: "assistant_delta", turnId, text: delta });
    };

    try {
      for (let step = 0; ; step++) {
        if (step >= this.maxSteps) {
          emit(`\n\n_(Остановлено: больше ${this.maxSteps} шагов подряд с инструментами.)_`);
          stopReason = "max_steps";
          break;
        }
        // Абзац между текстом до и после вызова инструментов.
        let separatorPending = step > 0 && wroteText;
        const result = await conv.step(
          this.opts.tools(),
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
        this.opts.log?.("ответ остановлен пользователем");
      } else {
        stopReason = "error";
        // Ход не завершился — откатываем его, чтобы история оставалась корректной.
        conv.rollback(turnStart);
        const message = this.provider.describeError(err);
        this.opts.log?.(`✖ ${message}`);
        this.opts.send({ type: "error", message });
      }
    } finally {
      this.busy = false;
      this.abort = null;
      this.opts.send({ type: "assistant_end", turnId, stopReason });
    }
  }

  private progress(taskId: string, title: string, status: TaskStatus, detail?: string, progress?: number) {
    this.opts.send({ type: "task_progress", taskId, title, status, detail, progress });
  }

  private async executeTool(call: ToolCall, signal: AbortSignal): Promise<ToolCallResult> {
    const fail = (content: string): ToolCallResult => ({ call, content, isError: true });
    const { name, input } = call;
    const tool = this.opts.tools().find((t) => t.name === name);
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
        this.opts.log?.(`✋ ${name}: отклонено`);
        return fail("Пользователь отклонил это действие. Не повторяй его без новой просьбы.");
      }
    }

    this.progress(taskId, name, "running");
    this.opts.log?.(`⚙ ${name} ${truncate(JSON.stringify(input), 200)}`);
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
      this.opts.log?.(`✖ ${name}: ${message}`);
      return fail(message);
    }
  }

  private requestConfirm(toolName: string, summary: string, input: unknown, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const requestId = makeId("r_");
      this.pendingConfirms.set(requestId, resolve);
      this.opts.send({ type: "confirm_request", requestId, toolName, summary, input });
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
