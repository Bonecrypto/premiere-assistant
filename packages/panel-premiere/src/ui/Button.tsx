import type { ReactNode } from "react";

/**
 * Кнопка на div: в UXP нативный <button> почти не поддаётся стилизации,
 * а div с onClick работает одинаково в Premiere и в браузере.
 */
export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "plain" | "danger";
  size?: "regular" | "small" | "large";
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const { children, onClick, variant = "secondary", size = "regular", disabled, title, className = "" } = props;
  return (
    <div
      className={`btn btn-${variant} btn-${size}${disabled ? " is-disabled" : ""} ${className}`}
      title={title}
      role="button"
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onClick?.();
      }}
    >
      {children}
    </div>
  );
}

/** Маленькая метка («Скоро», счётчик). */
export function Badge(props: { children: ReactNode; tone?: "accent" | "neutral" | "warn" }) {
  return <span className={`badge badge-${props.tone ?? "neutral"}`}>{props.children}</span>;
}

/** Квадратная иконка с градиентом — как иконки в настройках iOS/macOS. */
export function IconTile(props: { glyph: string; tone?: "blue" | "purple" | "indigo" | "green" | "orange" | "gray" }) {
  return <div className={`icon-tile tile-${props.tone ?? "blue"}`}>{props.glyph}</div>;
}
