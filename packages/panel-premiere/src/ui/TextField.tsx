import { useEffect, useRef } from "react";
import { isUXP } from "../env.ts";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "sp-textfield": any;
    }
  }
}

/**
 * Поле ввода. В Premiere нативный <input> рисуется системным полем Windows (чёрная полоса, свой шрифт)
 * и почти не стилизуется, поэтому в UXP — Spectrum-поле Adobe (sp-textfield, «quiet» — без рамки)
 * внутри нашей скруглённой капсулы. В браузере — обычный input.
 */
export function TextField(props: {
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  type?: "text" | "password";
  className?: string;
  onEnter?: () => void;
  /** Другие клавиши (стрелки, Escape) — для палитры команд. */
  onKey?: (key: string) => void;
  autoFocus?: boolean;
}) {
  const ref = useRef<any>(null);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const onEnter = useRef(props.onEnter);
  onEnter.current = props.onEnter;
  const onKey = useRef(props.onKey);
  onKey.current = props.onKey;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !isUXP) return;
    const h = (e: any) => onChange.current(String(e?.target?.value ?? el.value ?? ""));
    const k = (e: any) => {
      if (e.key === "Enter") onEnter.current?.();
      else if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape") {
        e.preventDefault?.();
        onKey.current?.(e.key);
      }
    };
    el.addEventListener("input", h);
    el.addEventListener("keydown", k);
    return () => {
      el.removeEventListener("input", h);
      el.removeEventListener("keydown", k);
    };
  }, []);

  useEffect(() => {
    if (!props.autoFocus) return;
    const t = setTimeout(() => (isUXP ? ref.current?.focus?.() : inputRef.current?.focus()), 60);
    return () => clearTimeout(t);
  }, [props.autoFocus]);

  // Значение снаружи (сброс, подстановка) — в поле.
  useEffect(() => {
    const el = ref.current;
    if (isUXP && el && el.value !== props.value) el.value = props.value;
  }, [props.value]);

  return (
    <div className={`tf ${props.className ?? ""}`}>
      {isUXP ? (
        <sp-textfield ref={ref} quiet class="tf-sp" type={props.type ?? "text"} placeholder={props.placeholder ?? ""} />
      ) : (
        <input
          ref={inputRef}
          className="tf-input"
          type={props.type ?? "text"}
          placeholder={props.placeholder}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") props.onEnter?.();
            else if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape") {
              e.preventDefault();
              props.onKey?.(e.key);
            }
          }}
        />
      )}
    </div>
  );
}
