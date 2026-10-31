/**
 * Протокол обмена панель ↔ помощник: JSON-сообщения по WebSocket (localhost).
 * Каждое сообщение — объект с полем "type".
 */
import type { ToolSpec } from "./tool.ts";

export const PROTOCOL_VERSION = 1;
export const DEFAULT_HELPER_PORT = 8765;

// ───────────── Панель → помощник ─────────────

/** Первое сообщение после подключения: кто подключился и какие host-инструменты умеет выполнять. */
export interface HelloMsg {
  type: "hello";
  protocolVersion: number;
  client: string; // "panel-premiere"
  hostApp?: { name: string; version?: string };
  hostTools: ToolSpec[];
}

export interface UserMessageMsg {
  type: "user_message";
  text: string;
}

/** Ответ пользователя на карточку подтверждения. */
export interface ConfirmResponseMsg {
  type: "confirm_response";
  requestId: string;
  approved: boolean;
}

/** Результат выполнения host-инструмента в панели. */
export interface ToolResultMsg {
  type: "tool_result";
  callId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Остановить текущий ответ/задачу. */
export interface CancelMsg {
  type: "cancel";
}

/** Начать новый диалог (очистить историю). */
export interface ResetMsg {
  type: "reset";
}

export type PanelToHelper =
  | HelloMsg
  | UserMessageMsg
  | ConfirmResponseMsg
  | ToolResultMsg
  | CancelMsg
  | ResetMsg;

// ───────────── Помощник → панель ─────────────

export interface HelloAckMsg {
  type: "hello_ack";
  protocolVersion: number;
  helperVersion: string;
  model: string;
  /** Есть ли API-ключ (сам ключ никогда не передаётся). */
  apiKeyConfigured: boolean;
  tools: Array<Pick<ToolSpec, "name" | "runsIn" | "mutates">>;
}

/** Ассистент начал отвечать. */
export interface AssistantStartMsg {
  type: "assistant_start";
  turnId: string;
}

/** Очередной кусок текста ответа (стриминг). */
export interface AssistantDeltaMsg {
  type: "assistant_delta";
  turnId: string;
  text: string;
}

/** Ответ закончен. */
export interface AssistantEndMsg {
  type: "assistant_end";
  turnId: string;
  stopReason: string; // end_turn | cancelled | error | refusal | max_tokens | ...
}

/** Помощник просит панель выполнить host-инструмент. */
export interface ToolCallMsg {
  type: "tool_call";
  callId: string;
  name: string;
  input: unknown;
}

/** Запрос подтверждения перед инструментом, который что-то меняет. */
export interface ConfirmRequestMsg {
  type: "confirm_request";
  requestId: string;
  toolName: string;
  /** Что именно изменится — человеческим языком. */
  summary: string;
  input: unknown;
}

export type TaskStatus = "running" | "done" | "error" | "cancelled" | "waiting_confirm";

/** Прогресс задачи / вызова инструмента — для лога задач. */
export interface TaskProgressMsg {
  type: "task_progress";
  taskId: string;
  title: string;
  status: TaskStatus;
  /** 0..1, если известен. */
  progress?: number;
  detail?: string;
}

export interface ErrorMsg {
  type: "error";
  message: string;
}

export type HelperToPanel =
  | HelloAckMsg
  | AssistantStartMsg
  | AssistantDeltaMsg
  | AssistantEndMsg
  | ToolCallMsg
  | ConfirmRequestMsg
  | TaskProgressMsg
  | ErrorMsg;

// ───────────── Утилиты ─────────────

const PANEL_TYPES = new Set<PanelToHelper["type"]>([
  "hello",
  "user_message",
  "confirm_response",
  "tool_result",
  "cancel",
  "reset",
]);

const HELPER_TYPES = new Set<HelperToPanel["type"]>([
  "hello_ack",
  "assistant_start",
  "assistant_delta",
  "assistant_end",
  "tool_call",
  "confirm_request",
  "task_progress",
  "error",
]);

function parse(raw: string): { type?: unknown } | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export function parsePanelMessage(raw: string): PanelToHelper | null {
  const v = parse(raw);
  return v && PANEL_TYPES.has(v.type as PanelToHelper["type"]) ? (v as PanelToHelper) : null;
}

export function parseHelperMessage(raw: string): HelperToPanel | null {
  const v = parse(raw);
  return v && HELPER_TYPES.has(v.type as HelperToPanel["type"]) ? (v as HelperToPanel) : null;
}

/** Короткий уникальный id без crypto.randomUUID (его может не быть в UXP). */
export function makeId(prefix = ""): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
