import type { HelloAckMsg } from "@pa/core";
import type { ConnectionStatus } from "../connection.ts";
import { Icon, type IconName } from "./Icon.tsx";
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

export interface TabDef<T extends string> {
  id: T;
  icon: IconName;
  label: string;
  badge?: number;
}

/**
 * Верхняя панель: логотип, вкладки-иконки в «таблетке» (подпись — во всплывающей подсказке
 * и у активной вкладки), справа — действие текущей вкладки.
 */
export function TopBar<T extends string>(props: {
  tabs: TabDef<T>[];
  tab: T;
  onTab(id: T): void;
  action?: { icon: IconName; title: string; onClick(): void; disabled?: boolean };
}) {
  return (
    <div className="topbar">
      <Logo size={24} className="topbar-logo" />
      <div className="tabpill" role="tablist">
        {props.tabs.map((t) => {
          const active = t.id === props.tab;
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={active}
              title={t.label}
              className={`tabpill-item${active ? " is-active" : ""}`}
              onClick={() => props.onTab(t.id)}
            >
              <Icon name={t.icon} size={15} />
              {active ? <span className="tabpill-label">{t.label}</span> : null}
              {t.badge ? <span className="tabpill-badge">{t.badge}</span> : null}
            </div>
          );
        })}
      </div>
      <div className="spacer" />
      {props.action ? (
        <div
          className={`icon-btn${props.action.disabled ? " is-disabled" : ""}`}
          title={props.action.title}
          onClick={() => !props.action!.disabled && props.action!.onClick()}
        >
          <Icon name={props.action.icon} size={15} />
        </div>
      ) : null}
    </div>
  );
}
