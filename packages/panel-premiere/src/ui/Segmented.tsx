import type { ReactNode } from "react";

export interface SegmentItem<T extends string> {
  id: T;
  label: ReactNode;
  badge?: number;
}

/** Сегментированный переключатель (как в macOS/iOS). Используется и для вкладок. */
export function Segmented<T extends string>(props: {
  items: SegmentItem<T>[];
  value: T;
  onChange(id: T): void;
  className?: string;
}) {
  return (
    <div className={`segmented ${props.className ?? ""}`} role="tablist">
      {props.items.map((it) => (
        <div
          key={it.id}
          role="tab"
          aria-selected={it.id === props.value}
          className={`segment${it.id === props.value ? " is-active" : ""}`}
          onClick={() => props.onChange(it.id)}
        >
          {it.label}
          {it.badge ? <span className="segment-badge">{it.badge}</span> : null}
        </div>
      ))}
    </div>
  );
}
