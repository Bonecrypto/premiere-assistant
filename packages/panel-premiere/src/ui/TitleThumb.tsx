import { useEffect, useRef, useState } from "react";

/**
 * Превью титра с анимацией при наведении. Настоящую анимацию .mogrt плагин проиграть не может,
 * поэтому движение подбирается по названию шаблона: «left in» — въезд слева, «zoom out» — отъезд,
 * «blur/opacity in» — проявление и т. п. Двигаем left/top/размер/прозрачность (transform/filter в UXP не работают).
 */

interface Motion {
  /** in — появляется и стоит, out — стоит и уходит, pulse — лёгкое «дыхание» для стилей без направления. */
  mode: "in" | "out" | "pulse";
  dx: number;
  dy: number;
  scale: number;
  fade: boolean;
}

export function motionFor(rawName: string): Motion {
  const n = rawName.replace(/^[.\s_-]+/, "").toLowerCase();
  const isOut = /(^|\s)out$/.test(n) || /\bout\b/.test(n);
  const isIn = /(^|\s)in$/.test(n) || /\bin\b/.test(n);
  const m: Motion = { mode: isOut ? "out" : isIn ? "in" : "pulse", dx: 0, dy: 0, scale: 1, fade: false };
  if (/\bleft\b|слева|влево/.test(n)) m.dx = -1;
  else if (/\bright\b|справа|вправо/.test(n)) m.dx = 1;
  else if (/\b(above|top|up)\b|сверху|вверх/.test(n)) m.dy = -1;
  else if (/\b(bottom|below|down)\b|снизу|вниз/.test(n)) m.dy = 1;
  if (/zoom|scale|pop|масштаб/.test(n)) m.scale = isOut ? 1.35 : 0.55;
  if (/blur|opacity|fade|dissolve|прозрач|размыт/.test(n)) m.fade = true;
  if (m.mode !== "pulse" && !m.dx && !m.dy && m.scale === 1) m.fade = true;
  return m;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;

/** Состояние в момент el (мс): f — доля «крайнего» состояния (1 — за кадром/прозрачно/в масштабе). */
function frame(m: Motion, el: number): { f: number; pulse: number } {
  const dur = 600;
  const hold = 900;
  if (m.mode === "pulse") return { f: 0, pulse: Math.sin((el / 1400) * Math.PI * 2) * 0.5 + 0.5 };
  const cycle = dur + hold * 2;
  const t = el % cycle;
  if (m.mode === "in") {
    if (t < 250) return { f: 1, pulse: 0 };
    const k = Math.min(1, (t - 250) / dur);
    return { f: 1 - easeOut(k), pulse: 0 };
  }
  if (t < hold) return { f: 0, pulse: 0 };
  const k = Math.min(1, (t - hold) / dur);
  return { f: easeIn(k), pulse: 0 };
}

export function TitleThumb(props: { src: string; name: string; playing: boolean }) {
  const [el, setEl] = useState(0);
  const start = useRef(0);
  const m = motionFor(props.name);

  useEffect(() => {
    if (!props.playing) {
      setEl(0);
      return;
    }
    start.current = Date.now();
    const t = setInterval(() => setEl(Date.now() - start.current), 33);
    return () => clearInterval(t);
  }, [props.playing]);

  let style: React.CSSProperties = {};
  if (props.playing) {
    const { f, pulse } = frame(m, el);
    if (m.mode === "pulse") {
      const s = 1 + pulse * 0.06;
      style = { width: `${s * 100}%`, height: `${s * 100}%`, left: `${(100 - s * 100) / 2}%`, top: `${(100 - s * 100) / 2}%` };
    } else {
      const s = 1 + (m.scale - 1) * f;
      const w = s * 100;
      style = {
        width: `${w}%`,
        height: `${w}%`,
        left: `${(100 - w) / 2 + m.dx * 100 * f}%`,
        top: `${(100 - w) / 2 + m.dy * 100 * f}%`,
        opacity: m.fade || m.scale !== 1 ? Math.max(0, 1 - f) : 1,
      };
    }
  }
  return <img className="title-thumb-img" src={props.src} alt="" style={style} />;
}
