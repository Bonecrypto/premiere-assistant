import { makeId, type ToolCallMsg } from "@pa/core";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { EmbeddedTransport } from "./agent/embedded.ts";
import { loadAiSettings, saveAiSettings, type AiSettings } from "./agent/settings.ts";
import { HelperConnection, getSavedPort, savePort, type Transport } from "./connection.ts";
import { isUXP, storageGet, storageSet } from "./env.ts";
import { getHostTool } from "./hostTools/index.ts";
import { initialState, reducer } from "./state.ts";
import { ChatView } from "./ui/ChatView.tsx";
import { Composer } from "./ui/Composer.tsx";
import { TopBar, health } from "./ui/Header.tsx";
import { StatusBar } from "./ui/StatusBar.tsx";
import { checkForUpdate, type UpdateInfo } from "./update/updater.ts";
import { Onboarding } from "./ui/Onboarding.tsx";
import { AutoView } from "./ui/AutoView.tsx";
import { PresetsView } from "./ui/PresetsView.tsx";
import { SettingsView } from "./ui/SettingsView.tsx";
import { TasksView } from "./ui/TasksView.tsx";

type Tab = "chat" | "auto" | "presets" | "tasks" | "settings";

const ONBOARDING_KEY = "onboardingDone";
const TAB_KEY = "activeTab";

function savedTab(): Tab {
  const t = storageGet(TAB_KEY);
  return t === "auto" || t === "presets" || t === "tasks" || t === "settings" ? t : "chat";
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [port, setPort] = useState(getSavedPort);
  const [tab, setTabState] = useState<Tab>(savedTab);
  const [onboarding, setOnboarding] = useState(() => storageGet(ONBOARDING_KEY) !== "1");
  const [draft, setDraft] = useState<string | null>(null);
  const [sequence, setSequence] = useState<string | null>(null);
  const connRef = useRef<Transport | null>(null);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  const checkUpdate = useCallback(async (): Promise<string> => {
    try {
      const info = await checkForUpdate();
      setUpdate(info);
      return info ? `Доступна v${info.version}` : "У вас последняя версия.";
    } catch (err) {
      return `Не удалось проверить: ${(err as Error)?.message || err}`;
    }
  }, []);

  // Проверка обновлений при запуске (тихо, через пару секунд).
  useEffect(() => {
    const t = setTimeout(() => void checkUpdate(), 3000);
    return () => clearTimeout(t);
  }, [checkUpdate]);

  useEffect(() => {
    void loadAiSettings().then(setAi);
  }, []);

  const saveAi = async (next: AiSettings) => {
    const saved = await saveAiSettings(next);
    setAi(saved);
  };

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

  // «Мозг»: встроенный ИИ прямо в панели (по умолчанию) или отдельный помощник.
  useEffect(() => {
    if (!ai) return;
    const onMessage = (msg: Parameters<ConstructorParameters<typeof HelperConnection>[1]>[0]) => {
      dispatch({ type: "helper", msg });
      if (msg.type === "tool_call") void runHostTool(msg);
      // Запрос подтверждения важнее текущей вкладки — показываем чат, чтобы его не пропустить.
      if (msg.type === "confirm_request") setTab("chat");
    };
    const onStatus = (status: Transport["status"]) => dispatch({ type: "status", status });
    dispatch({ type: "transport_switch" });
    const conn: Transport =
      ai.mode === "embedded" ? new EmbeddedTransport(ai, onMessage, onStatus) : new HelperConnection(port, onMessage, onStatus);
    connRef.current = conn;
    conn.start();
    return () => conn.stop();
  }, [runHostTool, ai, port]);

  // Активная секвенция для строки статуса (только чтение, раз в 5 с).
  useEffect(() => {
    if (!isUXP) return;
    const tool = getHostTool("premiere.get_context");
    if (!tool) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = (await tool.run({})) as { activeSequence?: { name: string } | null };
        if (alive) setSequence(r.activeSequence?.name ?? null);
      } catch {
        if (alive) setSequence(null);
      }
    };
    void poll();
    const t = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const send = (text: string) => {
    const conn = connRef.current;
    if (!conn || state.connection !== "connected") {
      dispatch({
        type: "notice",
        text: ai?.mode === "helper" ? "Нет связи с помощником. Запустите start-helper.cmd" : "ИИ ещё подключается — подождите пару секунд.",
        tone: "error",
      });
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
        <Onboarding connection={state.connection} helper={state.helper} onDone={finishOnboarding} ai={ai} onSaveAi={saveAi} />
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar<Tab>
        tabs={[
          { id: "chat", icon: "chat", label: "Чат" },
          { id: "auto", icon: "bolt", label: "Авто" },
          { id: "presets", icon: "presets", label: "Пресеты" },
          { id: "tasks", icon: "tasks", label: "Задачи", badge: activeTasks },
          { id: "settings", icon: "settings", label: "Настройки" },
        ]}
        tab={tab}
        onTab={setTab}
        action={
          tab === "chat"
            ? { icon: "compose", title: "Новый чат", onClick: newChat, disabled: state.busy || state.items.length === 0 }
            : undefined
        }
      />

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
            embedded={ai?.mode !== "helper"}
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
      {tab === "auto" ? <AutoView /> : null}
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
          ai={ai}
          onSaveAi={saveAi}
          update={update}
          onCheckUpdate={checkUpdate}
        />
      ) : null}
      <StatusBar
        state={hs}
        helper={state.helper}
        sequence={sequence}
        onClick={() => setTab("settings")}
        update={update}
        onUpdateClick={() => setTab("settings")}
      />
    </div>
  );
}
