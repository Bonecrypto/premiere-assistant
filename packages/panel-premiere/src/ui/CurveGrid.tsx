import { useState } from "react";
import { applyQuickEase, bakeCurve, unbakeCurve, type BakeOptions, type QuickEase } from "../automation/graph.ts";
import { Segmented } from "./Segmented.tsx";
import { storageGet, storageSet } from "../env.ts";
import { loadUserCurves, sameCurve, type Curve } from "../presets/curves.ts";
import { bezierPoint } from "./CurveEditor.tsx";
import { useSize } from "./useSize.ts";

/**
 * Сетка графиков (как в панелях Flow / Ease): клик по кривой сразу применяет её к ключам выделенных клипов.
 * Если у ключей уже есть наш график — он заменяется новым (старые доп. ключи удаляются, ваши остаются).
 */
export const GRID_CURVES: Array<{ id: string; name: string; curve: Curve; shape?: "launch" | "trampoline" }> = [
  { id: "launch", name: "вылет", curve: [0.05, 0.85, 0.1, 1], shape: "launch" },
  { id: "trampoline", name: "трамплин", curve: [0.9, 0, 0.95, 0.15], shape: "trampoline" },
  { id: "linear", name: "linear", curve: [0, 0, 1, 1] },
  { id: "easeIn", name: "easeIn", curve: [0.42, 0, 1, 1] },
  { id: "easeOut", name: "easeOut", curve: [0, 0, 0.58, 1] },
  { id: "ease", name: "ease", curve: [0.42, 0, 0.58, 1] },
  { id: "quadIn", name: "quadIn", curve: [0.11, 0, 0.5, 0] },
  { id: "quadOut", name: "quadOut", curve: [0.5, 1, 0.89, 1] },
  { id: "quad", name: "quad", curve: [0.45, 0, 0.55, 1] },
  { id: "cubicIn", name: "cubicIn", curve: [0.32, 0, 0.67, 0] },
  { id: "cubicOut", name: "cubicOut", curve: [0.33, 1, 0.68, 1] },
  { id: "cubic", name: "cubic", curve: [0.65, 0, 0.35, 1] },
  { id: "quartIn", name: "quartIn", curve: [0.5, 0, 0.75, 0] },
  { id: "quartOut", name: "quartOut", curve: [0.25, 1, 0.5, 1] },
  { id: "quart", name: "quart", curve: [0.76, 0, 0.24, 1] },
  { id: "quintIn", name: "quintIn", curve: [0.64, 0, 0.78, 0] },
  { id: "quintOut", name: "quintOut", curve: [0.22, 1, 0.36, 1] },
  { id: "quint", name: "quint", curve: [0.83, 0, 0.17, 1] },
  { id: "expoIn", name: "expoIn", curve: [0.7, 0, 0.84, 0] },
  { id: "expoOut", name: "expoOut", curve: [0.16, 1, 0.3, 1] },
  { id: "expo", name: "expo", curve: [0.87, 0, 0.13, 1] },
  { id: "circIn", name: "circIn", curve: [0.55, 0, 1, 0.45] },
  { id: "circOut", name: "circOut", curve: [0, 0.55, 0.45, 1] },
  { id: "circ", name: "circ", curve: [0.85, 0, 0.15, 1] },
  { id: "backIn", name: "backIn", curve: [0.36, 0, 0.66, -0.56] },
  { id: "backOut", name: "backOut", curve: [0.34, 1.56, 0.64, 1] },
  { id: "back", name: "back", curve: [0.68, -0.6, 0.32, 1.6] },
];

/** Миниатюра кривой с ручками (точки — UXP не рисует SVG/canvas надёжно). */
function GridThumb(props: { curve: Curve; size: number; active: boolean }) {
  const s = props.size;
  const pad = s * 0.14;
  const inner = s - pad * 2;
  // y может выходить за 0…1 (back) — сжимаем диапазон −0.6…1.6.
  const X = (x: number) => pad + x * inner;
  const Y = (y: number) => pad + ((1.25 - y) / 1.5) * inner;
  const dots: Array<{ x: number; y: number; c: string }> = [];
  const [x1, y1, x2, y2] = props.curve;
  const line = (ax: number, ay: number, bx: number, by: number, n: number) => {
    for (let i = 0; i <= n; i++) dots.push({ x: X(ax + ((bx - ax) * i) / n), y: Y(ay + ((by - ay) * i) / n), c: "h" });
  };
  line(0, 0, x1, y1, 7);
  line(1, 1, x2, y2, 7);
  for (let i = 0; i <= 44; i++) {
    const p = bezierPoint(props.curve, i / 44);
    dots.push({ x: X(p.x), y: Y(p.y), c: "c" });
  }
  return (
    <div className={`cg-thumb${props.active ? " is-active" : ""}`} style={{ width: s, height: s }}>
      {dots.map((d, i) => (
        <span key={i} className={d.c === "c" ? "cg-dot" : "cg-hdot"} style={{ left: d.x, top: d.y }} />
      ))}
      {[
        [x1, y1],
        [x2, y2],
        [0, 0],
        [1, 1],
      ].map(([x, y], i) => (
        <span key={`k${i}`} className="cg-knob" style={{ left: X(x), top: Y(y) }} />
      ))}
    </div>
  );
}

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

/**
 * Без новых ключей Premiere даёт менять только тип ключа (Linear/Bezier), силу ручек — нет.
 * Поэтому кривая сводится к ближайшему варианту: медленный старт → разгон (первый Bezier, последний Linear),
 * быстрый старт → торможение (первый Linear, последний Bezier), плавно с обеих сторон → Bezier, ровно → Linear.
 */
export function quickKindFor(c: Curve, shape?: "launch" | "trampoline"): QuickEase {
  if (shape) return shape;
  const [x1, y1, x2, y2] = c;
  // Крутизна в начале и в конце (1 — как линейно); ручка в самой точке ключа — тоже линейно.
  const start = x1 > 0.001 ? y1 / x1 : y1 > 0.001 ? 10 : 1;
  const end = 1 - x2 > 0.001 ? (1 - y2) / (1 - x2) : 1 - y2 > 0.001 ? 10 : 1;
  const slowStart = start < 0.6;
  const slowEnd = end < 0.6;
  if (!slowStart && !slowEnd) return Math.abs(start - 1) < 0.3 && Math.abs(end - 1) < 0.3 ? "linear" : "bezier";
  if (slowStart && !slowEnd) return "trampoline";
  if (!slowStart && slowEnd) return "launch";
  return "bezier";
}

const QUICK_NAME: Record<string, string> = { linear: "Linear", bezier: "Bezier с обеих сторон", trampoline: "разгон (Bezier → Linear)", launch: "торможение (Linear → Bezier)" };

export function CurveGrid(props: { opts: BakeOptions; onPick?: (c: Curve) => void }) {
  const [areaRef, area] = useSize();
  const [active, setActive] = useState<string>(() => storageGet("gridCurve") || "");
  const [status, setStatus] = useState<Status>(null);
  // По умолчанию — без новых ключей: меняется только тип ваших ключей.
  const [exact, setExactState] = useState(() => storageGet("gridExact") === "1");
  const setExact = (v: boolean) => {
    setExactState(v);
    storageSet("gridExact", v ? "1" : "0");
  };
  const items: Array<{ id: string; name: string; curve: Curve; shape?: "launch" | "trampoline" }> = [
    ...GRID_CURVES,
    ...loadUserCurves().map((u) => ({ id: u.id, name: u.name, curve: u.curve })),
  ];
  const cols = Math.max(3, Math.floor(((area.w || 360) + 4) / 66));
  const cell = Math.floor(((area.w || 360) - cols * 4) / cols);
  const thumb = Math.max(36, cell - 10);

  const pick = async (it: { id: string; name: string; curve: Curve; shape?: "launch" | "trampoline" }) => {
    setActive(it.id);
    storageSet("gridCurve", it.id);
    props.onPick?.(it.curve);
    setStatus({ tone: "busy", text: `${it.name}…` });
    if (!exact) {
      try {
        const kind = quickKindFor(it.curve, it.shape);
        const r = await applyQuickEase(kind, props.opts.scope);
        setStatus({
          tone: "ok",
          text: `${it.name}: ${r.keys} ключ. у ${r.params} парам. → ${QUICK_NAME[kind] ?? kind}. Новых ключей нет. Отмена — Ctrl+Z.`,
        });
      } catch (err) {
        setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
      }
      return;
    }
    try {
      const r = await bakeCurve(it.curve, it.shape ? { ...props.opts, step: 0, shape: it.shape } : props.opts);
      const skip = r.skipped.length ? ` Пропущено: ${r.skipped[0]}.` : "";
      setStatus({ tone: "ok", text: `${it.name}: ${r.clips} клип., ${r.segments} отрезк. Другая кривая — просто кликните её.${skip}` });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };

  const remove = async () => {
    setStatus({ tone: "busy", text: "Убираю график…" });
    try {
      const r = await unbakeCurve();
      setActive("");
      storageSet("gridCurve", "");
      setStatus({ tone: "ok", text: `Убрано ключей: ${r.removed}. Ваши ключи остались.` });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };

  return (
    <div className="cg">
      <Segmented<"keep" | "exact">
        className="segmented-small cg-mode"
        items={[
          { id: "keep", label: "Мои ключи" },
          { id: "exact", label: "Точно (+ключи)" },
        ]}
        value={exact ? "exact" : "keep"}
        onChange={(v) => setExact(v === "exact")}
      />
      <div className="cg-grid" ref={areaRef}>
        {items.map((it) => (
          <div
            key={it.id}
            className={`cg-cell${active === it.id ? " is-active" : ""}`}
            style={{ width: cell }}
            title={`${it.name} — клик: применить к ключам выделенных клипов`}
            onClick={() => void pick(it)}
          >
            <GridThumb curve={it.curve} size={thumb} active={active === it.id} />
            <div className="cg-name">{it.name}</div>
          </div>
        ))}
      </div>
      <div className="cg-foot">
        <span className={`cg-status${status ? ` status-${status.tone}` : ""}`}>
          {status
            ? status.text
            : exact
              ? "Точная форма: добавит несколько ключей. Другая кривая заменит их."
              : "Меняет только тип ваших ключей — новых не добавляет. Premiere не даёт плагинам менять силу ручек, поэтому quad/cubic/expo тут одинаковы."}
        </span>
        <span className="link-small" onClick={() => void remove()}>
          Убрать
        </span>
      </div>
    </div>
  );
}

export function isGridCurve(c: Curve): boolean {
  return GRID_CURVES.some((g) => sameCurve(g.curve, c));
}
