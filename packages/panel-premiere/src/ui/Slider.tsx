import { useRef } from "react";

/**
 * Ползунок на div: в UXP нативный input[type=range] почти не стилизуется.
 * Перетаскивание мышью и клик по дорожке.
 */
export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  format?: (v: number) => string;
  onChange(v: number): void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { min, max, step } = props;
  const pct = Math.max(0, Math.min(1, (props.value - min) / (max - min)));

  const setFromX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
    const raw = min + f * (max - min);
    const v = Math.round(raw / step) * step;
    props.onChange(Number(v.toFixed(4)));
  };

  const onDown = (e: React.MouseEvent) => {
    setFromX(e.clientX);
    const move = (ev: MouseEvent) => setFromX(ev.clientX);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="slider">
      <div className="slider-head">
        <span className="slider-label">{props.label}</span>
        <div className="spacer" />
        <span className="slider-value">
          {props.format ? props.format(props.value) : props.value}
          <span className="slider-unit"> {props.unit}</span>
        </span>
      </div>
      <div className="slider-track" ref={trackRef} onMouseDown={onDown}>
        <div className="slider-rail" />
        <div className="slider-fill" style={{ width: `${pct * 100}%` }} />
        <div className="slider-knob" style={{ left: `${pct * 100}%` }} />
      </div>
    </div>
  );
}
