import { useState } from "react";
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
 * Верхняя панель: логотип, главные вкладки в «таблетке», меню «•••» с остальными вкладками,
 * справа — действие текущей вкладки и шестерёнка настроек.
 */
export function TopBar<T extends string>(props: {
  tabs: TabDef<T>[];
  more?: TabDef<T>[];
  settings?: TabDef<T>;
  tab: T;
  onTab(id: T): void;
  action?: { icon: IconName; title: string; onClick(): void; disabled?: boolean };
}) {
  const [open, setOpen] = useState(false);
  const more = props.more ?? [];
  const activeMore = more.find((t) => t.id === props.tab);
  const moreBadge = more.reduce((n, t) => n + (t.badge ?? 0), 0);
  const item = (t: TabDef<T>) => {
    const active = t.id === props.tab;
    return (
      <div
        key={t.id}
        role="tab"
        aria-selected={active}
        title={t.label}
        className={`tabpill-item${active ? " is-active" : ""}`}
        onClick={() => {
          setOpen(false);
          props.onTab(t.id);
        }}
      >
        <Icon name={t.icon} size={15} />
        {active ? <span className="tabpill-label">{t.label}</span> : null}
        {t.badge ? <span className="tabpill-badge">{t.badge}</span> : null}
      </div>
    );
  };
  return (
    <div className="topbar">
      <Logo size={24} className="topbar-logo" />
      <div className="tabpill" role="tablist">
        {props.tabs.map(item)}
        {activeMore ? item(activeMore) : null}
        {more.length ? (
          <div className={`tabpill-item${open ? " is-open" : ""}`} title="Ещё вкладки" onClick={() => setOpen(!open)}>
            <Icon name="more" size={15} />
            {moreBadge && !activeMore ? <span className="tabpill-badge">{moreBadge}</span> : null}
          </div>
        ) : null}
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
      {props.settings ? (
        <div
          className={`icon-btn${props.tab === props.settings.id ? " is-active" : ""}`}
          title={props.settings.label}
          onClick={() => {
            setOpen(false);
            props.onTab(props.settings!.id);
          }}
        >
          <Icon name={props.settings.icon} size={15} />
        </div>
      ) : null}
      {open ? (
        <>
          <div className="more-backdrop" onClick={() => setOpen(false)} />
          <div className="more-menu">
            {more.map((t) => (
              <div
                key={t.id}
                className={`more-item${t.id === props.tab ? " is-active" : ""}`}
                onClick={() => {
                  setOpen(false);
                  props.onTab(t.id);
                }}
              >
                <Icon name={t.icon} size={15} />
                <span className="more-label">{t.label}</span>
                {t.badge ? <span className="tabpill-badge">{t.badge}</span> : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
