/**
 * Контракт инструмента (tool). Каждая возможность ассистента — отдельный инструмент.
 * Имена с префиксом хоста: "premiere.*", позже "ae.*"; общие: "audio.*", "files.*", "web.*", "knowledge.*".
 */

/** Минимальное подмножество JSON Schema, которого хватает для описания входа инструмента. */
export interface JSONSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: Array<string | number>;
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

export type ToolRunsIn = "host" | "helper";

/** Описание инструмента без кода — то, что можно передать по сети. */
export interface ToolSpec {
  /** "premiere.read_timeline", "audio.measure_loudness" */
  name: string;
  /** Для модели: что делает и когда использовать. */
  description: string;
  inputSchema: JSONSchema;
  /** Где исполняется: в панели (Premiere API) или в помощнике (Node). */
  runsIn: ToolRunsIn;
  /** Меняет проект/файлы? Тогда перед запуском обязательно подтверждение пользователя. */
  mutates: boolean;
  /**
   * Для host-инструментов: текст карточки подтверждения (что именно изменится).
   * Задаётся панелью — модель его не пишет и подменить не может.
   */
  confirmText?: string;
}

export interface ToolContext {
  /** Сообщить о ходе долгой операции (попадёт в лог задач панели). */
  progress(detail: string, progress?: number): void;
  /** Сигнал отмены (пользователь нажал «Стоп»). */
  signal: AbortSignal;
}

export interface ToolDef<Input = any> extends ToolSpec {
  /**
   * Человекочитаемое описание того, что именно изменится. Показывается в карточке подтверждения.
   * Обязательно продумать для инструментов с mutates: true.
   */
  describe?(input: Input): string;
  run(input: Input, ctx: ToolContext): Promise<unknown>;
}

/**
 * Модель принимает имена инструментов только из [a-zA-Z0-9_-], поэтому точка
 * в имени ("premiere.read_timeline") кодируется как "__" при отправке в API.
 */
export function toApiToolName(name: string): string {
  return name.replace(/\./g, "__");
}

export function fromApiToolName(apiName: string): string {
  return apiName.replace(/__/g, ".");
}

export const TOOL_NAME_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
