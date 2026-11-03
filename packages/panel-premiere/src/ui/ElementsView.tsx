import { useRef, useState } from "react";
import { storageGet, storageSet } from "../env.ts";
import { GRAPHIC_COLORS, GRAPHICS, thumbOf, type Dir } from "../graphics/elements.ts";
import { insertGraphic, type Anim } from "../graphics/insert.ts";
import { Segmented } from "./Segmented.tsx";
import { Slider } from "./Slider.tsx";
import { useFitTiles, useSize } from "./useSize.ts";

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

const GROUPS = ["Стрелки", "Линии", "Выделение", "Значки", "Плашки"] as const;
type ElSet = "neon" | "own";
const SETS: Array<{ id: ElSet; label: string }> = [
  { id: "neon", label: "Неон" },
  { id: "own", label: "Свой цвет" },
];
const ofSet = (set: ElSet) => GRAPHICS.filter((x) => (set === "neon") === !!x.neon);
const DIRS: Array<{ id: Dir; label: string }> = [
  { id: "right", label: "→" },
  { id: "down", label: "↓" },
  { id: "left", label: "←" },
  { id: "up", label: "↑" },
];
const ANIMS: Array<{ id: Anim; label: string }> = [
  { id: "draw", label: "Прорисовка" },
  { id: "pop", label: "Поп" },
  { id: "fade", label: "Плавно" },
  { id: "none", label: "Без" },
];

function load<T>(key: string, def: T): T {
  try {
    const v = JSON.parse(storageGet(key) || "null");
    return v ?? def;
  } catch {
    return def;
  }
}

/** Размер плитки, при котором все элементы помещаются без прокрутки. */
function fit(w: number, h: number, list: typeof GRAPHICS): number {
  if (!w || !h) return 84;
  for (let s = 110; s >= 50; s -= 4) {
    const cols = Math.max(1, Math.floor((w + 6) / (s + 6)));
    const tileH = Math.round((s * 9) / 16) + (s >= 76 ? 22 : 18);
    const total = GROUPS.reduce((n, g) => n + Math.ceil(list.filter((x) => x.group === g).length / cols) * tileH + 18, 0);
    if (total <= h) return s;
  }
  return 50;
}

/** Вкладка «Элементы»: готовая графика (стрелки, подчёркивания, обводки, значки, плашки) одним кликом. */
export function ElementsView() {
  const [color, setColor] = useState<string>(() => load("elColor", "#ffffff"));
  const [dir, setDir] = useState<Dir>(() => load("elDir", "right"));
  const [anim, setAnim] = useState<Anim>(() => load("elAnim", "draw"));
  const [secs, setSecs] = useState<number>(() => load("elSecs", 3));
  const [status, setStatus] = useState<Status>(null);
  const [set, setSet] = useState<ElSet>(() => load("elSet", "neon"));
  const list = ofSet(set);
  const [areaRef, area] = useSize();
  const contentRef = useRef<HTMLDivElement>(null);
  const size = useFitTiles(area, fit(area.w, area.h, list), contentRef, [set]);
  const save = (k: string, v: unknown) => storageSet(k, JSON.stringify(v));

  const insert = async (id: string, name: string) => {
    setStatus({ tone: "busy", text: `Вставляю «${name}»…` });
    try {
      setStatus({ tone: "ok", text: await insertGraphic(id, { color, dir, anim, seconds: secs }) });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };

  return (
    <div className="pv">
      <div className="recipe-head">
        <div className="el-row">
          <Segmented
            className="el-anims"
            items={SETS}
            value={set}
            onChange={(v) => {
              setSet(v);
              save("elSet", v);
            }}
          />
        </div>
        {set === "own" ? (
        <div className="el-row">
          {GRAPHIC_COLORS.map((c) => (
            <div
              key={c.hex}
              className={`el-color${c.hex === color ? " is-active" : ""}`}
              style={{ backgroundColor: c.hex }}
              title={c.name}
              onClick={() => {
                setColor(c.hex);
                save("elColor", c.hex);
              }}
            />
          ))}
          <div className="spacer" />
          <Segmented
            className="el-dirs"
            items={DIRS}
            value={dir}
            onChange={(v) => {
              setDir(v);
              save("elDir", v);
            }}
          />
        </div>
        ) : null}
        <div className="el-row">
          <Segmented
            className="el-anims"
            items={ANIMS}
            value={anim}
            onChange={(v) => {
              setAnim(v);
              save("elAnim", v);
            }}
          />
        </div>
        <Slider
          label="Длина на таймлайне"
          value={secs}
          min={1}
          max={10}
          step={0.5}
          unit=" с"
          onChange={(v) => {
            setSecs(v);
            save("elSecs", v);
          }}
        />
      </div>
      <div className="recipe-area" ref={areaRef}>
        <div ref={contentRef}>
        <div className="recipe-grid">
          {GROUPS.filter((g) => list.some((x) => x.group === g)).map((g) => [
            <div key={`label-${g}`} className="recipe-label-cell" style={{ width: size }}>
              {g}
            </div>,
            ...list.filter((x) => x.group === g).map((x) => (
              <div
                key={x.id}
                className={`recipe-tile${size < 76 ? " is-small" : ""}`}
                style={{ width: size }}
                title={`${x.name} — клик: вставить под плейхед`}
                onClick={() => void insert(x.id, x.name)}
              >
                <img className="recipe-thumb" src={thumbOf(x.id)} alt="" style={{ width: size - 6, height: Math.round(((size - 6) * 9) / 16) }} />
                <div className="recipe-name">{x.name}</div>
              </div>
            )),
          ])}
        </div>
        </div>
      </div>
      <div className="pv-footer">
        <span className={`pv-footer-text${status ? ` status-${status.tone}` : ""}`}>
          {status ? status.text : set === "neon" ? "Клик — элемент под плейхед на свободную дорожку. Размер — Scale в Effect Controls." : "Клик — элемент под плейхед на свободную дорожку. Направление — для стрелок."}
        </span>
      </div>
    </div>
  );
}
