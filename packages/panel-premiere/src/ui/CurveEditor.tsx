import { useEffect, useRef, useState } from "react";
import { easeFn, type Curve } from "../presets/curves.ts";

/**
 * Редактор графика плавности: две ручки (тянуть мышью), кривая, живой шарик.
 * Всё на div — canvas и transform в UXP ненадёжны. По вертикали есть запас для «перелёта» (y от −0.5 до 1.5).
 */

const Y_MIN = -0.5;
const Y_MAX = 1.5;

export function bezierPoint(c: Curve, t: number): { x: number; y: number } {
  const [x1, y1, x2, y2] = c;
  const u = 1 - t;
  return {
    x: 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t,
    y: 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t,
  };
}

export function CurveEditor(props: { value: Curve; onChange(c: Curve): void; height?: number; showBall?: boolean }) {
  const H = props.height ?? 170;
  const box = useRef<HTMLDivElement>(null);
  const c = props.value;

  // Перевод координат графика в проценты рамки.
  const px = (x: number) => x * 100;
  const py = (y: number) => ((Y_MAX - y) / (Y_MAX - Y_MIN)) * 100;

  const drag = (which: 0 | 1) => (e: React.MouseEvent) => {
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      const el = box.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width)));
      const y = Math.max(Y_MIN, Math.min(Y_MAX, Y_MAX - ((ev.clientY - r.top) / Math.max(1, r.height)) * (Y_MAX - Y_MIN)));
      const rx = Math.round(x * 100) / 100;
      const ry = Math.round(y * 100) / 100;
      const next: Curve = which === 0 ? [rx, ry, c[2], c[3]] : [c[0], c[1], rx, ry];
      props.onChange(next);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const dots: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 90; i++) dots.push(bezierPoint(c, i / 90));
  const line = (ax: number, ay: number, bx: number, by: number) => {
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 1; i < 14; i++) out.push({ x: ax + ((bx - ax) * i) / 14, y: ay + ((by - ay) * i) / 14 });
    return out;
  };

  return (
    <div className="curve">
      <div className="curve-box" ref={box} style={{ height: H }}>
        {/* Сетка: 0 и 1 по вертикали, четверти по горизонтали */}
        <div className="curve-hline is-main" style={{ top: `${py(0)}%` }} />
        <div className="curve-hline is-main" style={{ top: `${py(1)}%` }} />
        <div className="curve-hline" style={{ top: `${py(0.5)}%` }} />
        {[0.25, 0.5, 0.75].map((x) => (
          <div key={x} className="curve-vline" style={{ left: `${px(x)}%` }} />
        ))}
        {line(0, 0, c[0], c[1]).map((d, i) => (
          <span key={`a${i}`} className="curve-guide" style={{ left: `${px(d.x)}%`, top: `${py(d.y)}%` }} />
        ))}
        {line(1, 1, c[2], c[3]).map((d, i) => (
          <span key={`b${i}`} className="curve-guide" style={{ left: `${px(d.x)}%`, top: `${py(d.y)}%` }} />
        ))}
        {dots.map((d, i) => (
          <span key={i} className="curve-dot" style={{ left: `${px(d.x)}%`, top: `${py(d.y)}%` }} />
        ))}
        <span className="curve-end" style={{ left: `${px(0)}%`, top: `${py(0)}%` }} />
        <span className="curve-end" style={{ left: `${px(1)}%`, top: `${py(1)}%` }} />
        <div className="curve-handle" style={{ left: `${px(c[0])}%`, top: `${py(c[1])}%` }} onMouseDown={drag(0)} title="Тяните" />
        <div className="curve-handle" style={{ left: `${px(c[2])}%`, top: `${py(c[3])}%` }} onMouseDown={drag(1)} title="Тяните" />
      </div>
      {props.showBall === false ? null : <EaseBall curve={c} />}
    </div>
  );
}

/** Шарик, который едет по кривой — сразу видно характер движения. */
export function EaseBall(props: { curve: Curve; duration?: number }) {
  const [k, setK] = useState(0);
  const key = props.curve.join(",");
  useEffect(() => {
    const ease = easeFn(props.curve);
    const dur = (props.duration ?? 0.9) * 1000;
    const hold = 450;
    const start = Date.now();
    const t = setInterval(() => {
      const el = (Date.now() - start) % (dur + hold * 2);
      const x = el < hold ? 0 : el > dur + hold ? 1 : (el - hold) / dur;
      setK(ease(x));
    }, 30);
    return () => clearInterval(t);
  }, [key, props.duration]);
  return (
    <div className="ease-track">
      <span className="ease-ball" style={{ left: `${4 + k * 88}%` }} />
    </div>
  );
}

/** Маленький график для карточки пресета (без ручек). */
export function CurveThumb(props: { curve: Curve; active?: boolean }) {
  const dots: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 28; i++) dots.push(bezierPoint(props.curve, i / 28));
  return (
    <div className={`curve-thumb${props.active ? " is-active" : ""}`}>
      {dots.map((d, i) => (
        <span key={i} className="curve-thumb-dot" style={{ left: `${10 + d.x * 80}%`, top: `${((1.3 - d.y) / 1.6) * 80 + 10}%` }} />
      ))}
    </div>
  );
}
