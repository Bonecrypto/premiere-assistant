import type { HelloAckMsg } from "@pa/core";
import type { ConnectionStatus } from "../connection.ts";
import { Logo } from "./Logo.tsx";

export type HealthState = "ok" | "warn" | "connecting" | "off";

export function health(connection: ConnectionStatus, helper: HelloAckMsg | null): HealthState {
  if (connection === "connecting") return "connecting";
  if (connection !== "connected") return "off";
  // Подключились, но помощник ещё не прислал свои данные (ключ, модель) — рано говорить «Готов».
  if (!helper) return "connecting";
  if (!helper.apiKeyConfigured) return "warn";
  return "ok";
}

const LABEL: Record<HealthState, string> = {
  ok: "Готов",
  warn: "Нет ключа",
  connecting: "Подключение…",
  off: "Не подключён",
};

/** Шапка: название плагина и «пилюля» статуса (видимость состояния системы). */
export function Header(props: {
  state: HealthState;
  onStatusClick(): void;
  action?: { label: string; title: string; onClick(): void; disabled?: boolean };
}) {
  return (
    <div className="header">
      <Logo size={22} className="app-mark" />
      <div className="app-title">Ассистент</div>
      <div className="spacer" />
      {props.action ? (
        <div
          className={`header-action${props.action.disabled ? " is-disabled" : ""}`}
          title={props.action.title}
          onClick={() => !props.action!.disabled && props.action!.onClick()}
        >
          {props.action.label}
        </div>
      ) : null}
      <div className={`status-pill pill-${props.state}`} onClick={props.onStatusClick} title="Подробнее — в настройках">
        <span className="pill-dot" />
        {LABEL[props.state]}
      </div>
    </div>
  );
}
