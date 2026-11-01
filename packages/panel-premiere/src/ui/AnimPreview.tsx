import { useEffect, useRef, useState } from "react";
import type { AnimKind } from "../presets/animations.ts";

export interface PreviewParams {
  kind: AnimKind;
  dx: number;
  dy: number;
  distance: number;
  scale: number;
  rotation: number;
  fade: boolean;
  duration: number;
  easing: "bezier" | "linear";
}

const FRAME_W = 100; // в процентах от рамки превью
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/**
 * Живое превью анимации: прямоугольник-«клип» в кадре. Только позиция, размер и прозрачность —
 * transform в UXP не поддерживается, поэтому поворот показываем подписью.
 */
export function AnimPreview(props: { params: PreviewParams; replayKey: number }) {
  const [t, setT] = useState(0);
  const start = useRef(0);
  const p = props.params;

  useEffect(() => {
    start.current = Date.now();
    const total = (p.kind === "whole" ? Math.max(1.5, p.duration) : p.duration) * 1000;
    const hold = 700;
    const timer = setInterval(() => {
      const el = (Date.now() - start.current) % (total + hold * 2);
      setT(el < hold ? 0 : el > total + hold ? 1 : (el - hold) / total);
    }, 33);
    return () => clearInterval(timer);
  }, [props.replayKey, p.kind, p.duration]);

  const k = p.easing === "bezier" ? easeInOut(t) : t;
  // f — насколько клип в «крайнем» состоянии (1 — за краем/масштаб/прозрачный).
  const f = p.kind === "in" ? 1 - k : k;
  const d = p.distance / 100;
  const scale = 1 + (p.scale / 100 - 1) * f;
  const w = 56 * scale;
  const h = 56 * scale;
  const left = 50 + p.dx * FRAME_W * d * f - w / 2;
  const top = 50 + p.dy * FRAME_W * d * f - h / 2;
  const opacity = p.fade ? 1 - f : 1;

  return (
    <div className="preview">
      <div className="preview-frame">
        <div
          className="preview-clip"
          style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%`, opacity }}
        >
          <span className="preview-clip-label">клип</span>
        </div>
        {p.rotation ? <span className="preview-badge">↻ {p.rotation}°</span> : null}
      </div>
    </div>
  );
}
