import { makeId, type ToolCallMsg } from "@pa/core";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { HelperConnection, getSavedPort, savePort } from "./connection.ts";
import { isUXP } from "./env.ts";
import { getHostTool } from "./hostTools/index.ts";
import { initialState, reducer } from "./state.ts";
import { ChatView } from "./ui/ChatView.tsx";
import { Composer } from "./ui/Composer.tsx";
import { Header } from "./ui/Header.tsx";
import { Settings } from "./ui/Settings.tsx";
import { TaskLog } from "./ui/TaskLog.tsx";

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [port, setPort] = useState(getSavedPort);
  const [showSettings, setShowSettings] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const connRef = useRef<HelperConnection | null>(null);

  // Выполнение host-инструмента по запросу помощника.
  const runHostTool = useCallback(async (msg: ToolCallMsg) => {
    const conn = connRef.current;
    const tool = getHostTool(msg.name);
    const taskId = `host-${msg.callId}`;
    if (!tool) {
      conn?.send({ type: "tool_result", callId: msg.callId, ok: false, error: `В панели нет инструмента "${msg.name}"` });
      return;
    }
    dispatch({ type: "local_task", task: { taskId, title: `${msg.name} (Premiere)`, status: "running" } });
    try {
      const result = await tool.run(msg.input ?? {});
      conn?.send({ type: "tool_result", callId: msg.callId, ok: true, result });
      dispatch({ type: "local_task", task: { taskId, title: `${msg.name} (Premiere)`, status: "done" } });
    } catch (err) {
      const error = (err as Error)?.message || String(err);
      conn?.send({ type: "tool_result", callId: msg.callId, ok: false, error });
      dispatch({ type: "local_task", task: { taskId, title: `${msg.name} (Premiere)`, status: "error", detail: error } });
    }
  }, []);

  useEffect(() => {
    const conn = new HelperConnection(
      getSavedPort(),
      (msg) => {
        dispatch({ type: "helper", msg });
        if (msg.type === "tool_call") void runHostTool(msg);
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
      dispatch({ type: "notice", text: "Нет связи с помощником. Запустите его: npm start", tone: "error" });
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

  const stop = () => connRef.current?.send({ type: "cancel" });

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

  const activeTasks = state.tasks.filter((t) => t.status === "running" || t.status === "waiting_confirm").length;

  return (
    <div className="app">
      <Header
        connection={state.connection}
        helper={state.helper}
        port={port}
        busy={state.busy}
        activeTasks={activeTasks}
        tasksOpen={showTasks}
        onToggleTasks={() => setShowTasks((v) => !v)}
        onToggleSettings={() => setShowSettings((v) => !v)}
        onNewChat={newChat}
        onReconnect={() => connRef.current?.reconnectNow()}
      />
      {showSettings && (
        <Settings port={port} onChangePort={changePort} onClose={() => setShowSettings(false)} isUXP={isUXP} />
      )}
      {showTasks && <TaskLog tasks={state.tasks} onClear={() => dispatch({ type: "clear_tasks" })} />}
      <ChatView
        items={state.items}
        helper={state.helper}
        connection={state.connection}
        busy={state.busy}
        onConfirm={answerConfirm}
      />
      <Composer
        disabled={state.connection !== "connected"}
        busy={state.busy}
        onSend={send}
        onStop={stop}
      />
    </div>
  );
}
