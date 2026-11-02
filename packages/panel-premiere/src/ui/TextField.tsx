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
}) {
  const ref = useRef<any>(null);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const onEnter = useRef(props.onEnter);
  onEnter.current = props.onEnter;

  useEffect(() => {
    const el = ref.current;
    if (!el || !isUXP) return;
    const h = (e: any) => onChange.current(String(e?.target?.value ?? el.value ?? ""));
    const k = (e: any) => {
      if (e.key === "Enter") onEnter.current?.();
    };
    el.addEventListener("input", h);
    el.addEventListener("keydown", k);
    return () => {
      el.removeEventListener("input", h);
      el.removeEventListener("keydown", k);
    };
  }, []);

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
          className="tf-input"
          type={props.type ?? "text"}
          placeholder={props.placeholder}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") props.onEnter?.();
          }}
        />
      )}
    </div>
  );
}
