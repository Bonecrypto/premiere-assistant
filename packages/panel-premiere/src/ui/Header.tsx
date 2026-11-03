import { useEffect, useRef, useState } from "react";
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
 * Верхняя панель: логотип, все вкладки иконками в одной «таблетке» (без всплывающих меню — в Premiere они
 * не нажимаются), подпись у активной — если хватает ширины; справа — действие вкладки и шестерёнка настроек.
 */
export function TopBar<T extends string>(props: {
  tabs: TabDef<T>[];
  settings?: TabDef<T>;
  tab: T;
  onTab(id: T): void;
  action?: { icon: IconName; title: string; onClick(): void; disabled?: boolean };
  /** Кнопка поиска (палитра команд). */
  search?: { onClick(): void; active?: boolean };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const measure = () => {
      const w = ref.current?.offsetWidth ?? 0;
      if (w && w !== width) setWidth(w);
    };
    measure();
    const t = setInterval(measure, 800);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", measure);
    };
  });
  // Иконка ≈ 30 px; логотип, шестерёнка и действие ≈ 110 px; подпись ≈ 80 px.
  const showLabel = width >= props.tabs.length * 30 + 110 + 80;
  // Широкая панель — подписи у всех вкладок (≈ 6.8 px на букву).
  const allLabels = width >= props.tabs.reduce((n, t) => n + 34 + t.label.length * 6.8, 0) + 120;
  const compact = width > 0 && width < props.tabs.length * 30 + 110;
  return (
    <div className={`topbar${compact ? " is-compact" : ""}`} ref={ref}>
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
              {allLabels || (active && showLabel) ? <span className="tabpill-label">{t.label}</span> : null}
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
      {props.search ? (
        <div className={`icon-btn${props.search.active ? " is-active" : ""}`} title="Поиск команд (Ctrl+K)" onClick={() => props.search!.onClick()}>
          <Icon name="search" size={15} />
        </div>
      ) : null}
      {props.settings ? (
        <div
          className={`icon-btn${props.tab === props.settings.id ? " is-active" : ""}`}
          title={props.settings.label}
          onClick={() => props.onTab(props.settings!.id)}
        >
          <Icon name={props.settings.icon} size={15} />
        </div>
      ) : null}
    </div>
  );
}
