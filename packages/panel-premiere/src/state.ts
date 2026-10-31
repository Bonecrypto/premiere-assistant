import type { HelloAckMsg, HelperToPanel, TaskStatus } from "@pa/core";
import type { ConnectionStatus } from "./connection.ts";

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; turnId: string; text: string; streaming: boolean; stopReason?: string }
  | {
      kind: "confirm";
      id: string;
      toolName: string;
      summary: string;
      input: unknown;
      state: "pending" | "approved" | "rejected" | "expired";
    }
  | { kind: "notice"; id: string; text: string; tone: "error" | "info" };

export interface TaskEntry {
  taskId: string;
  title: string;
  status: TaskStatus;
  detail?: string;
  progress?: number;
  updatedAt: number;
}

export interface State {
  connection: ConnectionStatus;
  helper: HelloAckMsg | null;
  items: ChatItem[];
  tasks: TaskEntry[];
  busy: boolean;
  currentTurn: string | null;
}

export const initialState: State = {
  connection: "disconnected",
  helper: null,
  items: [],
  tasks: [],
  busy: false,
  currentTurn: null,
};

export type Action =
  | { type: "status"; status: ConnectionStatus }
  | { type: "helper"; msg: HelperToPanel }
  | { type: "user"; id: string; text: string }
  | { type: "confirm_answered"; requestId: string; approved: boolean }
  | { type: "notice"; text: string; tone: "error" | "info" }
  | { type: "reset" }
  | { type: "clear_tasks" };

let noticeSeq = 0;
const MAX_TASKS = 50;

function upsertTask(tasks: TaskEntry[], t: Omit<TaskEntry, "updatedAt">): TaskEntry[] {
  const entry = { ...t, updatedAt: Date.now() };
  const i = tasks.findIndex((x) => x.taskId === t.taskId);
  if (i === -1) return [entry, ...tasks].slice(0, MAX_TASKS);
  const copy = tasks.slice();
  copy[i] = { ...copy[i], ...entry };
  return copy;
}

/** Все незакрытые карточки подтверждения — «просрочены» (помощник уже не ждёт ответа). */
function expireConfirms(items: ChatItem[]): ChatItem[] {
  return items.map((it) => (it.kind === "confirm" && it.state === "pending" ? { ...it, state: "expired" } : it));
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "status": {
      if (action.status === "connected") return { ...state, connection: "connected" };
      const wasConnected = state.connection === "connected";
      return {
        ...state,
        connection: action.status,
        helper: action.status === "disconnected" ? null : state.helper,
        busy: false,
        currentTurn: null,
        items: wasConnected
          ? [
              ...expireConfirms(state.items).map((it) =>
                it.kind === "assistant" && it.streaming ? { ...it, streaming: false } : it,
              ),
              { kind: "notice", id: `n${++noticeSeq}`, text: "Связь с помощником потеряна. Переподключаюсь…", tone: "error" },
            ]
          : state.items,
      };
    }

    case "user":
      return {
        ...state,
        busy: true,
        items: [...state.items, { kind: "user", id: action.id, text: action.text }],
      };

    case "confirm_answered":
      return {
        ...state,
        items: state.items.map((it) =>
          it.kind === "confirm" && it.id === action.requestId
            ? { ...it, state: action.approved ? "approved" : "rejected" }
            : it,
        ),
      };

    case "notice":
      return {
        ...state,
        items: [...state.items, { kind: "notice", id: `n${++noticeSeq}`, text: action.text, tone: action.tone }],
      };

    case "reset":
      return { ...state, items: [], tasks: [] };

    case "clear_tasks":
      return { ...state, tasks: state.tasks.filter((t) => t.status === "running" || t.status === "waiting_confirm") };

    case "helper":
      return onHelperMessage(state, action.msg);
  }
}

function onHelperMessage(state: State, msg: HelperToPanel): State {
  switch (msg.type) {
    case "hello_ack":
      return { ...state, helper: msg };

    case "assistant_start":
      return { ...state, busy: true, currentTurn: msg.turnId };

    case "assistant_delta": {
      // Текст дописывается в последний пузырь этого ответа. Если после него появилась
      // карточка подтверждения или уведомление — начинаем новый пузырь ниже, чтобы порядок был хронологическим.
      const last = state.items[state.items.length - 1];
      if (last && last.kind === "assistant" && last.turnId === msg.turnId) {
        const items = state.items.slice();
        items[items.length - 1] = { ...last, text: last.text + msg.text };
        return { ...state, items };
      }
      const text = msg.text.replace(/^\n+/, "");
      if (!text) return state;
      return {
        ...state,
        items: [
          ...state.items,
          { kind: "assistant", id: `${msg.turnId}-${state.items.length}`, turnId: msg.turnId, text, streaming: true },
        ],
      };
    }

    case "assistant_end": {
      const items = expireConfirms(state.items).map((it) =>
        it.kind === "assistant" && it.turnId === msg.turnId ? { ...it, streaming: false } : it,
      );
      // Пометка «остановлено» — у последнего пузыря ответа.
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === "assistant" && it.turnId === msg.turnId) {
          items[i] = { ...it, stopReason: msg.stopReason };
          break;
        }
      }
      return { ...state, busy: false, currentTurn: null, items };
    }

    case "confirm_request":
      return {
        ...state,
        items: [
          ...state.items,
          {
            kind: "confirm",
            id: msg.requestId,
            toolName: msg.toolName,
            summary: msg.summary,
            input: msg.input,
            state: "pending",
          },
        ],
      };

    case "task_progress":
      return {
        ...state,
        tasks: upsertTask(state.tasks, {
          taskId: msg.taskId,
          title: msg.title,
          status: msg.status,
          detail: msg.detail,
          progress: msg.progress,
        }),
      };

    case "error":
      return {
        ...state,
        items: [...state.items, { kind: "notice", id: `n${++noticeSeq}`, text: msg.message, tone: "error" }],
      };

    case "tool_call":
      // Выполняется в App (side effect); статус приходит отдельным task_progress.
      return state;
  }
}
