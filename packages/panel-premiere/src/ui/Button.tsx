import type { ReactNode } from "react";

/**
 * Кнопка на div: в UXP нативный <button> почти не поддаётся стилизации,
 * а div с onClick работает одинаково в Premiere и в браузере.
 */
export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const { children, onClick, variant = "secondary", disabled, title, className = "" } = props;
  return (
    <div
      className={`btn btn-${variant}${disabled ? " btn-disabled" : ""} ${className}`}
      title={title}
      role="button"
      onClick={() => {
        if (!disabled) onClick?.();
      }}
    >
      {children}
    </div>
  );
}
