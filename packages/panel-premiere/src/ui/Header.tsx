import type { HelloAckMsg } from "@pa/core";
import type { ConnectionStatus } from "../connection.ts";
import { Button } from "./Button.tsx";

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connected: "Подключено",
  connecting: "Подключаюсь…",
  disconnected: "Нет связи",
};

export function Header(props: {
  connection: ConnectionStatus;
  helper: HelloAckMsg | null;
  port: number;
  busy: boolean;
  activeTasks: number;
  tasksOpen: boolean;
  onToggleTasks(): void;
  onToggleSettings(): void;
  onNewChat(): void;
  onReconnect(): void;
}) {
  const { connection, helper } = props;
  const warn = connection === "connected" && helper && !helper.apiKeyConfigured;
  const tooltip =
    connection === "connected" && helper
      ? `Помощник v${helper.helperVersion} · модель ${helper.model} · порт ${props.port}`
      : `Помощник на ws://localhost:${props.port} — запустите: npm start`;

  return (
    <div className="header">
      <div className="status" title={tooltip} onClick={connection !== "connected" ? props.onReconnect : undefined}>
        <div className={`dot dot-${warn ? "warn" : connection}`} />
        <span className="status-text">{warn ? "Нет API-ключа" : STATUS_TEXT[connection]}</span>
      </div>
      <div className="spacer" />
      <Button variant="ghost" onClick={props.onToggleTasks} title="Лог задач" className={props.tasksOpen ? "active" : ""}>
        Задачи{props.activeTasks > 0 ? ` (${props.activeTasks})` : ""}
      </Button>
      <Button variant="ghost" onClick={props.onNewChat} disabled={props.busy} title="Начать новый диалог">
        Новый
      </Button>
      <Button variant="ghost" onClick={props.onToggleSettings} title="Настройки">
        ⚙
      </Button>
    </div>
  );
}
