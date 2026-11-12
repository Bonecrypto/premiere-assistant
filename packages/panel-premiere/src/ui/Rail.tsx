import { useState } from "react";
import { storageGet, storageSet } from "../env.ts";
import { Logo } from "./Logo.tsx";
import { TINT_ICONS, TONE_COLORS } from "./tintIcons.ts";

/**
 * Боковая навигация (как в Ethena OS): цветная иконка в тонированной плитке + подпись.
 * Узкая панель — только иконки; широкая — с подписями. Редкие разделы — под «Ещё».
 */
export interface RailItem<T extends string> {
  id: T;
  label: string;
  icon: string;
  tone: string;
  badge?: number;
}

/** rgba из #rrggbb. */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function Tile(props: { icon: string; tone: string; active?: boolean }) {
  const c = TONE_COLORS[props.tone] ?? "#a1a1aa";
  return (
    <div className="rail-tile" style={{ backgroundColor: alpha(c, props.active ? 0.22 : 0.1), borderColor: alpha(c, props.active ? 0.55 : 0.22) }}>
      <img className="rail-icon" src={TINT_ICONS[`${props.icon}-${props.tone}`]} alt="" />
    </div>
  );
}

export function Rail<T extends string>(props: {
  wide: boolean;
  main: RailItem<T>[];
  more: RailItem<T>[];
  active: T;
  onSelect(id: T): void;
  onSearch(): void;
  searchActive?: boolean;
}) {
  const [open, setOpen] = useState(() => storageGet("railMore") !== "0");
  const toggle = () => {
    setOpen(!open);
    storageSet("railMore", open ? "0" : "1");
  };
  const row = (it: RailItem<T>) => {
    const active = it.id === props.active;
    const c = TONE_COLORS[it.tone] ?? "#a1a1aa";
    return (
      <div
        key={it.id}
        className={`rail-row${active ? " is-active" : ""}`}
        style={active ? { backgroundColor: alpha(c, 0.12) } : undefined}
        title={it.label}
        onClick={() => props.onSelect(it.id)}
      >
        <Tile icon={it.icon} tone={it.tone} active={active} />
        {props.wide ? <span className="rail-label">{it.label}</span> : null}
        {it.badge ? <span className="rail-badge">{it.badge}</span> : null}
      </div>
    );
  };
  // Активный раздел из «Ещё» виден и при свёрнутом «Ещё».
  const moreShown = open ? props.more : props.more.filter((m) => m.id === props.active);
  return (
    <div className={`rail${props.wide ? " is-wide" : ""}`}>
      <div className="rail-brand">
        <Logo size={26} />
        {props.wide ? <span className="rail-brand-name">Assistant</span> : null}
      </div>
      <div className={`rail-row rail-search${props.searchActive ? " is-active" : ""}`} title="Поиск команд (Ctrl+K)" onClick={props.onSearch}>
        <Tile icon="search" tone="gray" active={props.searchActive} />
        {props.wide ? <span className="rail-label rail-muted">Поиск</span> : null}
      </div>
      {props.main.map(row)}
      <div className="rail-more" onClick={toggle} title={open ? "Свернуть" : "Ещё разделы"}>
        {props.wide ? <span className="rail-more-label">ЕЩЁ</span> : null}
        <span className="rail-more-chev">{open ? "▾" : "▸"}</span>
      </div>
      {moreShown.map(row)}
    </div>
  );
}
