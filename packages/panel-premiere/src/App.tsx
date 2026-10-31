import { makeId, type ToolCallMsg } from "@pa/core";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { HelperConnection, getSavedPort, savePort } from "./connection.ts";
import { isUXP, storageGet, storageSet } from "./env.ts";
import { getHostTool } from "./hostTools/index.ts";
import { initialState, reducer } from "./state.ts";
import { ChatView } from "./ui/ChatView.tsx";
import { Composer } from "./ui/Composer.tsx";
import { Header, health } from "./ui/Header.tsx";
import { Onboarding } from "./ui/Onboarding.tsx";
import { PresetsView } from "./ui/PresetsView.tsx";
import { Segmented } from "./ui/Segmented.tsx";
import { SettingsView } from "./ui/SettingsView.tsx";
import { TasksView } from "./ui/TasksView.tsx";

type Tab = "chat" | "presets" | "tasks" | "settings";

const ONBOARDING_KEY = "onboardingDone";
const TAB_KEY = "activeTab";

function savedTab(): Tab {
  const t = storageGet(TAB_KEY);
  return t === "presets" || t === "tasks" || t === "settings" ? t : "chat";
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [port, setPort] = useState(getSavedPort);
  const [tab, setTabState] = useState<Tab>(savedTab);
  const [onboarding, setOnboarding] = useState(() => storageGet(ONBOARDING_KEY) !== "1");
  const [draft, setDraft] = useState<string | null>(null);
  const connRef = useRef<HelperConnection | null>(null);

  const setTab = (t: Tab) => {
    setTabState(t);
    storageSet(TAB_KEY, t);
  };

  // Выполнение host-инструмента по запросу помощника (статус в «Задачах» присылает сам помощник).
  const runHostTool = useCallback(async (msg: ToolCallMsg) => {
    const conn = connRef.current;
    const tool = getHostTool(msg.name);
    if (!tool) {
      conn?.send({ type: "tool_result", callId: msg.callId, ok: false, error: `В панели нет инструмента "${msg.name}"` });
      return;
    }
    try {
      const result = await tool.run(msg.input ?? {});
      conn?.send({ type: "tool_result", callId: msg.callId, ok: true, result });
    } catch (err) {
      conn?.send({ type: "tool_result", callId: msg.callId, ok: false, error: (err as Error)?.message || String(err) });
    }
  }, []);

  useEffect(() => {
    const conn = new HelperConnection(
      getSavedPort(),
      (msg) => {
        dispatch({ type: "helper", msg });
        if (msg.type === "tool_call") void runHostTool(msg);
        // Запрос подтверждения важнее текущей вкладки — показываем чат, чтобы его не пропустить.
        if (msg.type === "confirm_request") setTab("chat");
      },
      (status) => dispatch({ type: "status", status }),
    );
    connRef.current = conn;
    conn.start();
    return () => conn.stop();
  }, [runHostTool]);

  const send = (text: string) => {
    const conn = connRef.current;
    if (!conn || state.connection !== "connected") {
      dispatch({ type: "notice", text: "Нет связи с помощником. Запустите start-helper.cmd", tone: "error" });
      return;
    }
    dispatch({ type: "user", id: makeId("u_"), text });
    if (!conn.send({ type: "user_message", text })) {
      dispatch({ type: "notice", text: "Не удалось отправить сообщение.", tone: "error" });
    }
  };

  const answerConfirm = (requestId: string, approved: boolean) => {
    connRef.current?.send({ type: "confirm_response", requestId, approved });
    dispatch({ type: "confirm_answered", requestId, approved });
  };

  const newChat = () => {
    if (state.busy) return;
    connRef.current?.send({ type: "reset" });
    dispatch({ type: "reset" });
  };

  const changePort = (p: number) => {
    savePort(p);
    setPort(p);
    connRef.current?.setPort(p);
  };

  const finishOnboarding = () => {
    storageSet(ONBOARDING_KEY, "1");
    setOnboarding(false);
    setTab("chat");
  };

  const hs = health(state.connection, state.helper);
  const activeTasks = state.tasks.filter((t) => t.status === "running" || t.status === "waiting_confirm").length;

  if (onboarding) {
    return (
      <div className="app">
        <Onboarding connection={state.connection} helper={state.helper} onDone={finishOnboarding} />
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        state={hs}
        onStatusClick={() => setTab("settings")}
        action={
          tab === "chat"
            ? { label: "Новый чат", title: "Начать новый диалог", onClick: newChat, disabled: state.busy || state.items.length === 0 }
            : undefined
        }
      />
      <div className="tabbar">
        <Segmented<Tab>
          items={[
            { id: "chat", label: "Чат" },
            { id: "presets", label: "Пресеты" },
            { id: "tasks", label: "Задачи", badge: activeTasks },
            { id: "settings", label: "Настройки" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === "chat" ? (
        <>
          <ChatView
            items={state.items}
            helper={state.helper}
            health={hs}
            busy={state.busy}
            onConfirm={answerConfirm}
            onSuggestion={setDraft}
            onOpenSettings={() => setTab("settings")}
          />
          <Composer
            disabled={state.connection !== "connected"}
            busy={state.busy}
            draft={draft}
            onDraftConsumed={() => setDraft(null)}
            onSend={send}
            onStop={() => connRef.current?.send({ type: "cancel" })}
          />
        </>
      ) : null}
      {tab === "presets" ? <PresetsView /> : null}
      {tab === "tasks" ? <TasksView tasks={state.tasks} onClear={() => dispatch({ type: "clear_tasks" })} /> : null}
      {tab === "settings" ? (
        <SettingsView
          connection={state.connection}
          helper={state.helper}
          port={port}
          isUXP={isUXP}
          onChangePort={changePort}
          onReconnect={() => connRef.current?.reconnectNow()}
          onShowOnboarding={() => setOnboarding(true)}
        />
      ) : null}
    </div>
  );
}
