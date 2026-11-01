/**
 * Протокол обмена панель ↔ помощник: JSON-сообщения по WebSocket (localhost).
 * Каждое сообщение — объект с полем "type".
 */
import type { ToolSpec } from "./tool.ts";

export const PROTOCOL_VERSION = 1;
export const DEFAULT_HELPER_PORT = 8765;
/** Как часто панель шлёт ping (мс). Помощник считает панель пропавшей после 4 пропусков. */
export const PING_INTERVAL_MS = 10_000;

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

/**
 * «Я на связи» — панель шлёт раз в несколько секунд. Нужен потому, что WebSocket в UXP
 * не отвечает на служебные ping-кадры, и по ним нельзя понять, жива ли панель.
 */
export interface PingMsg {
  type: "ping";
}

/**
 * Нажать горячие клавиши в Premiere (Windows). Нужен для автопокраски клипов на таймлайне:
 * панель выделяет клипы, помощник нажимает клавишу метки (Edit → Label → цвет).
 * Помощник принимает только комбинации из KEY_ALLOWLIST — произвольный ввод запрещён.
 */
export interface SendKeysMsg {
  type: "send_keys";
  id: string;
  keys: string[];
}

export type PanelToHelper =
  | SendKeysMsg
  | HelloMsg
  | UserMessageMsg
  | ConfirmResponseMsg
  | ToolResultMsg
  | CancelMsg
  | ResetMsg
  | PingMsg;

// ───────────── Помощник → панель ─────────────

export interface HelloAckMsg {
  type: "hello_ack";
  protocolVersion: number;
  helperVersion: string;
  model: string;
  /** Кто отвечает: «Claude», «Gemini». */
  provider?: string;
  /** Как называется переменная с ключом в .env — для подсказок. */
  apiKeyVar?: string;
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
  | KeysDoneMsg
  | ErrorMsg;

export interface KeysDoneMsg {
  type: "keys_done";
  id: string;
  ok: boolean;
  error?: string;
}

/** Фокус на таймлайн (Shift+3 в Premiere по умолчанию) и клавиши меток: Ctrl+Alt+Shift+1…9, 0, F1…F6. */
export const KEY_TIMELINE_FOCUS = "shift+3";
export const LABEL_KEYS_COMBOS = [
  "ctrl+alt+shift+1", "ctrl+alt+shift+2", "ctrl+alt+shift+3", "ctrl+alt+shift+4", "ctrl+alt+shift+5",
  "ctrl+alt+shift+6", "ctrl+alt+shift+7", "ctrl+alt+shift+8", "ctrl+alt+shift+9", "ctrl+alt+shift+0",
  "ctrl+alt+shift+f1", "ctrl+alt+shift+f2", "ctrl+alt+shift+f3", "ctrl+alt+shift+f4", "ctrl+alt+shift+f5", "ctrl+alt+shift+f6",
];
export const KEY_ALLOWLIST = new Set<string>([KEY_TIMELINE_FOCUS, ...LABEL_KEYS_COMBOS]);

// ───────────── Утилиты ─────────────

const PANEL_TYPES = new Set<PanelToHelper["type"]>([
  "send_keys",
  "hello",
  "user_message",
  "confirm_response",
  "tool_result",
  "cancel",
  "reset",
  "ping",
]);

const HELPER_TYPES = new Set<HelperToPanel["type"]>([
  "hello_ack",
  "assistant_start",
  "assistant_delta",
  "assistant_end",
  "tool_call",
  "confirm_request",
  "task_progress",
  "keys_done",
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
