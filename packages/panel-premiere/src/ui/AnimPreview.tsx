import { useEffect, useRef, useState } from "react";
import type { AnimKind } from "../presets/animations.ts";
import { easeFn } from "../presets/curves.ts";

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
  overshoot?: number;
  /** Свой график плавности. */
  curve?: [number, number, number, number] | null;
  blurAmt?: number;
  shake?: number;
  through?: boolean;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const SHAKE = [
  [1, -0.6], [-0.8, 0.9], [0.5, 0.7], [-1, -0.3], [0.7, -1], [-0.4, 0.8], [0.9, 0.2], [-0.6, -0.9], [0.3, 1], [-0.9, 0.4],
];

/** Доля «крайнего» состояния (1 — крайнее, 0 — обычное, <0 — перелёт) на пути от крайнего к обычному. */
function towardNormal(k: number, over: number, ease: (t: number) => number): number {
  if (over <= 0) return 1 - ease(k);
  const m = 0.72;
  if (k < m) return 1 - (1 + over) * ease(k / m);
  return -over * (1 - ease((k - m) / (1 - m)));
}

interface Frame {
  f: number;
  sign: 1 | -1;
  shakeLife: number;
  shakeIndex: number;
}

/** Состояние анимации в момент el (мс) цикла. Возвращает также полную длину цикла. */
function frameAt(p: PreviewParams, el: number): Frame {
  const custom = p.curve ? easeFn(p.curve) : null;
  const ease = custom ?? (p.easing === "bezier" ? easeInOut : (t: number) => t);
  const over = custom ? 0 : Math.max(0, p.overshoot ?? 0) / 100;
  // Со своим графиком: на входе путь идёт от крайней точки к обычной, на выходе — наоборот (как в движке).
  const toward = (k: number, isOut: boolean) => (custom ? (isOut ? custom(1 - k) : 1 - custom(k)) : towardNormal(isOut ? 1 - k : k, over, ease));
  const dur = Math.max(0.1, p.duration) * 1000;
  const hold = 600;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const shake = (p.shake ?? 0) > 0;
  const shakeIndex = Math.floor(el / 42);

  if (shake) {
    if (p.kind === "whole") return { f: 0, sign: 1, shakeLife: 1, shakeIndex };
    const k = clamp((el - hold) / dur);
    const active = el >= hold && el <= hold + dur;
    const life = !active ? 0 : p.kind === "out" ? k : 1 - k;
    return { f: 0, sign: 1, shakeLife: life, shakeIndex };
  }
  if (p.kind === "in") return { f: toward(clamp((el - hold) / dur), false), sign: 1, shakeLife: 0, shakeIndex };
  if (p.kind === "out") return { f: toward(1 - clamp((el - hold) / dur), true), sign: 1, shakeLife: 0, shakeIndex };
  if (p.kind === "whole") {
    const total = Math.max(1500, dur);
    return { f: ease(clamp((el - hold) / total)), sign: 1, shakeLife: 0, shakeIndex };
  }
  // both: вход, пауза, выход
  const tIn = el - hold;
  if (tIn < dur + hold) return { f: toward(clamp(tIn / dur), false), sign: 1, shakeLife: 0, shakeIndex };
  const tOut = tIn - dur - hold;
  return { f: toward(1 - clamp(tOut / dur), true), sign: p.through ? -1 : 1, shakeLife: 0, shakeIndex };
}

function cycleLength(p: PreviewParams): number {
  const dur = Math.max(0.1, p.duration) * 1000;
  const hold = 600;
  if (p.kind === "whole") return Math.max(1500, dur) + hold * 2;
  if (p.kind === "both") return dur * 2 + hold * 3;
  return dur + hold * 2;
}

/**
 * Живое превью анимации: прямоугольник-«клип» в кадре. Позиция, размер и прозрачность —
 * transform/filter в UXP не поддерживаются, поэтому поворот и размытие показываем подписью.
 * mini — маленькое превью для карточки; playing=false — стоит на месте.
 */
export function AnimPreview(props: { params: PreviewParams; replayKey?: number; mini?: boolean; playing?: boolean }) {
  const [el, setEl] = useState(0);
  const start = useRef(0);
  const p = props.params;
  const playing = props.playing ?? true;

  useEffect(() => {
    if (!playing) return;
    start.current = Date.now();
    const total = cycleLength(p);
    const timer = setInterval(() => setEl((Date.now() - start.current) % total), 33);
    return () => clearInterval(timer);
  }, [props.replayKey, playing, p.kind, p.duration, p.overshoot, p.shake, p.through, (p.curve ?? []).join(",")]);

  // Без проигрывания — показываем клип в обычном состоянии.
  const staticEl = p.kind === "in" ? 1e9 : p.kind === "both" ? 700 + Math.max(0.1, p.duration) * 1000 : 0;
  const fr = frameAt(p, playing ? el : staticEl);
  const f = fr.f;
  const fa = Math.max(0, Math.min(1, f));
  const d = p.distance / 100;
  const base = props.mini ? 50 : 56;
  const scale = Math.max(0.05, 1 + (p.scale / 100 - 1) * f);
  const w = base * scale;
  const h = base * scale;
  const [sx, sy] = SHAKE[fr.shakeIndex % SHAKE.length];
  const amp = (p.shake ?? 0) * 2.2 * fr.shakeLife;
  const left = 50 + p.dx * 100 * d * f * fr.sign - w / 2 + sx * amp;
  const top = 50 + p.dy * 100 * d * f * fr.sign - h / 2 + sy * amp;
  const blur = (p.blurAmt ?? 0) * fa;
  const opacity = (p.fade ? 1 - fa : 1) * (blur ? 1 - Math.min(0.5, blur / 120) : 1);

  return (
    <div className={props.mini ? "preview preview-mini" : "preview"}>
      <div className="preview-frame">
        <div
          className="preview-clip"
          style={{
            left: `${left}%`,
            top: `${top}%`,
            width: `${w}%`,
            height: `${h}%`,
            opacity: Math.max(0, Math.min(1, opacity)),
            filter: blur ? `blur(${(blur / 100) * (props.mini ? 3 : 6)}px)` : undefined,
          }}
        >
          {props.mini ? null : <span className="preview-clip-label">клип</span>}
        </div>
        {!props.mini && p.rotation ? <span className="preview-badge">↻ {p.rotation}°</span> : null}
        {!props.mini && p.blurAmt ? <span className="preview-badge preview-badge-left">размытие {p.blurAmt}</span> : null}
      </div>
    </div>
  );
}
