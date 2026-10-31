import type { ToolDef } from "@pa/core";

/** Вызов инструмента, который запросила модель. */
export interface ToolCall {
  /** Внутренний id вызова (для лога задач и сопоставления результата). */
  id: string;
  /** Имя инструмента в нашем формате: "premiere.get_context". */
  name: string;
  input: unknown;
}

export interface ToolCallResult {
  call: ToolCall;
  content: string;
  isError: boolean;
}

export type StepStop =
  /** Ответ закончен. */
  | "done"
  /** Модель просит выполнить инструменты. */
  | "tool_calls"
  /** Модель продолжит отвечать на следующем шаге без новых данных. */
  | "continue"
  /** Модель отказалась отвечать (фильтры безопасности). */
  | "refusal"
  /** Достигнут лимит длины ответа. */
  | "max_tokens";

export interface StepResult {
  stop: StepStop;
  toolCalls: ToolCall[];
}

/**
 * Диалог с конкретной моделью. Хранит историю в «родном» формате провайдера,
 * наружу отдаёт единые шаги: текст (стримом) + запросы инструментов.
 */
export interface Conversation {
  addUserText(text: string): void;
  /** Один запрос к модели. Текст ответа отдаётся по кусочкам через onText. */
  step(tools: ToolDef[], onText: (delta: string) => void, signal: AbortSignal): Promise<StepResult>;
  addToolResults(results: ToolCallResult[]): void;
  /** Точка отката: длина истории. */
  checkpoint(): number;
  rollback(to: number): void;
  reset(): void;
}

export interface ChatProvider {
  /** "claude" | "gemini" */
  id: string;
  /** Название для людей: «Claude», «Gemini». */
  title: string;
  model: string;
  apiKeyConfigured: boolean;
  /** Где задать ключ — для подсказок пользователю. */
  apiKeyVar: string;
  createConversation(systemPrompt: string): Conversation;
  /** Ошибка API → понятный человеку текст. */
  describeError(err: unknown): string;
  /** Это отмена пользователем, а не ошибка? */
  isAbort(err: unknown): boolean;
}
