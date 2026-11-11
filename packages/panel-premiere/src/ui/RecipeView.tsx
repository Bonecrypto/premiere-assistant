import { useRef, useState } from "react";
import { animateSelected } from "../automation/animate.ts";
import { applyFxPreset, loadFxPresets } from "../automation/fxPresets.ts";
import { applyRecipe, type FxRecipe } from "../automation/fxRecipes.ts";
import { storageGet, storageSet } from "../env.ts";
import { loadAnimOptions } from "../presets/animations.ts";
import { COLOR_RECIPES, FX_RECIPES } from "../presets/fxLibrary.ts";
import { LIBRARY } from "../presets/library.ts";
import { adjustmentLayer, adjustmentWithTransform, blackVideo, colorMatte } from "../automation/quickCreate.ts";
import { FX_THUMBS } from "./fxThumbs.ts";
import { useFitTiles, useSize } from "./useSize.ts";
import { flashSelected } from "../automation/flash.ts";
import { removeBackgroundSelected } from "../automation/removeBg.ts";
import { applyHit, HITS } from "../automation/hits.ts";
import { Slider } from "./Slider.tsx";
import { textReveal, TEXT_REVEALS } from "../automation/textReveal.ts";

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

interface Tile {
  key: string;
  name: string;
  desc: string;
  group: string;
  /** Цвета миниатюры (градиент). */
  swatch: [string, string];
  /** Картинка плитки (fxThumbs), иначе — градиент. */
  thumb?: string;
  /** Применять сразу по клику (без «Применить»). */
  instant?: boolean;
  run(strength: number, report?: (text: string) => void): Promise<string>;
}

const SWATCH: Record<string, [string, string]> = {
  "soft-bg": ["#5b6b8c", "#1d2333"],
  dream: ["#f3c6ff", "#7a5cff"],
  "bw-contrast": ["#f2f2f2", "#111111"],
  vhs: ["#ff4f8b", "#2b6cff"],
  film: ["#e8b878", "#5a3a1a"],
  sharpen: ["#9ad0ff", "#20405f"],
  pixel: ["#7cff9b", "#1f6b3a"],
  "stop-motion": ["#ffd166", "#ef476f"],
  "transform-mb": ["#9f18ec", "#22045e"],
  "round-s": ["#e5e5ea", "#8e8e93"],
  "round-m": ["#d1d1d6", "#636366"],
  "round-l": ["#c7c7cc", "#48484a"],
  invert: ["#00e5ff", "#ff1744"],
  warm: ["#ffb26b", "#c2410c"],
  cold: ["#8ecbff", "#1e3a8a"],
  sunset: ["#ff9a8b", "#ff6a88"],
  night: ["#3b4a7a", "#0b1024"],
  cinema: ["#1fb5a8", "#f08a24"],
  vivid: ["#ff2fb3", "#ffd400"],
  faded: ["#cbbfae", "#7d7468"],
  bw: ["#d9d9d9", "#2a2a2a"],
  vignette: ["#888888", "#000000"],
  reset: ["#3a3a44", "#1a1a20"],
};

function recipeTiles(list: FxRecipe[]): Tile[] {
  return list.map((r) => ({
    key: r.id,
    name: r.name,
    desc: r.desc,
    group: r.group,
    swatch: SWATCH[r.id] ?? ["#7a1cf0", "#22045e"],
    thumb: FX_THUMBS[r.id],
    run: async (strength) => {
      const res = await applyRecipe(r, strength);
      const miss = res.missing.length ? ` Не нашёл: ${res.missing.slice(0, 3).join(", ")}.` : "";
      return `«${r.name}» — ${res.clips} клип. Отмена — Ctrl+Z.${miss}`;
    },
  }));
}

/** Ключи «одним кликом» — для ключей, которые пользователь поставил сам. */

/** «Создать»: элементы на таймлайн одним кликом. */
const CREATE: Array<{ id: string; name: string; desc: string; run: () => Promise<string> }> = [
  { id: "create-black", name: "Black Video", desc: "Чёрный кадр на свободную дорожку", run: blackVideo },
  { id: "create-adjust", name: "Adjustment Layer", desc: "Корректирующий слой — эффекты на всё ниже", run: adjustmentLayer },
  { id: "create-adjust-tf", name: "Adjust. + Transform", desc: "Корректирующий слой сразу с Transform (блюр 360): двигаете его — двигается всё ниже", run: adjustmentWithTransform },
  { id: "create-white", name: "Белый фон", desc: "Color Matte белого цвета", run: () => colorMatte("#ffffff") },
  { id: "create-green", name: "Хромакей", desc: "Зелёная плашка (Color Matte)", run: () => colorMatte("#00b140") },
  { id: "create-purple", name: "Фиолетовая", desc: "Color Matte фирменного цвета", run: () => colorMatte("#9f18ec") },
  { id: "create-red", name: "Красная", desc: "Color Matte красного цвета", run: () => colorMatte("#ff3b30") },
  { id: "create-yellow", name: "Жёлтая", desc: "Color Matte жёлтого цвета", run: () => colorMatte("#ffd60a") },
  { id: "create-blue", name: "Синяя", desc: "Color Matte синего цвета", run: () => colorMatte("#0a84ff") },
  { id: "create-pink", name: "Розовая", desc: "Color Matte розового цвета (Vice)", run: () => colorMatte("#ff4fa3") },
  { id: "create-gray", name: "Серая", desc: "Color Matte серого цвета — подложка, плашка", run: () => colorMatte("#808080") },
];

/** Плитки вкладки «Эффекты»: пачки + движение + свои пачки из «Пресеты → Эффекты». */
function effectsTiles(): { main: Tile[]; text: Tile[] } {
  const mine: Tile[] = loadFxPresets().map((f) => ({
    key: `my-${f.id}`,
    name: f.name,
    desc: `${f.components.length} эфф. · ${f.kind === "video" ? "видео" : "звук"}`,
    group: "Мои",
    swatch: ["#2a2a35", "#15151b"],
    thumb: FX_THUMBS.mine,
    run: async () => {
      const r = await applyFxPreset(f);
      return `«${f.name}» — ${r.changed} клип. Отмена — Ctrl+Z (2 раза).`;
    },
  }));
  const flash: Tile[] = [
    { key: "flash-bright", name: "Вспышка", desc: "Объект вспыхивает на 4 кадра и возвращается (от плейхеда или с начала клипа)", kind: "bright" as const },
    { key: "flash-glow", name: "Блик контура", desc: "Контур PNG/текста светится 4 кадра (Alpha Glow)", kind: "glow" as const },
  ].map((f) => ({
    key: f.key,
    name: f.name,
    desc: f.desc,
    group: "Свечение",
    swatch: ["#ffffff", "#9f18ec"],
    thumb: FX_THUMBS[f.key],
    instant: true,
    run: () => flashSelected(f.kind, 4),
  }));
  const ai: Tile[] = [
    {
      key: "ai-removebg",
      name: "Убрать фон",
      desc: "Нейросеть на компьютере (на видеокарте): вырезает человека/объект с картинки или видео и кладёт над исходником — для «текста за человеком»",
      group: "Картинка",
      swatch: ["#9f18ec", "#22045e"],
      thumb: FX_THUMBS["ai-removebg"],
      instant: true,
      run: (_s, report) => removeBackgroundSelected(report),
    },
  ];
  const hits: Tile[] = HITS.map((h) => ({
    key: h.id,
    name: h.name,
    desc: `${h.desc} — от плейхеда`,
    group: "Удары",
    swatch: ["#ffffff", "#9f18ec"],
    thumb: FX_THUMBS[h.id],
    instant: true,
    run: () => applyHit(h.id),
  }));
  const create: Tile[] = CREATE.map((c) => ({
    key: c.id,
    name: c.name,
    desc: c.desc,
    group: "Создать",
    swatch: ["#000000", "#000000"],
    thumb: FX_THUMBS[c.id],
    instant: true,
    run: c.run,
  }));
  // Текст: проявления шторкой + анимации из библиотеки (раздел «Текст»).
  const text: Tile[] = [
    ...TEXT_REVEALS.map((r) => ({
      key: `txt-${r.id}`,
      name: r.name,
      desc: r.desc,
      group: "Текст",
      swatch: ["#ffffff", "#9f18ec"] as [string, string],
      thumb: FX_THUMBS[`txt-${r.id}`],
      instant: true,
      run: () => textReveal(r.id),
    })),
    ...LIBRARY.filter((a) => a.category === "Текст").map((a) => ({
      key: a.id,
      name: a.name,
      desc: `${a.kind === "out" ? "Исчезновение" : a.kind === "both" ? "Появление и исчезновение" : "Появление"} текста — весь слой`,
      group: "Текст",
      swatch: ["#ffffff", "#9f18ec"] as [string, string],
      thumb: FX_THUMBS[a.id],
      instant: true,
      run: async () => `«${a.name}» — ${(await animateSelected(a, loadAnimOptions())).changed} клип. Отмена — Ctrl+Z.`,
    })),
  ];
  return { main: [...ai, ...hits, ...create, ...flash, ...recipeTiles(FX_RECIPES.filter((r) => r.group !== "Виньетка")), ...mine], text };
}

/** «Движение → Текст»: проявления шторкой + текстовые анимации (баунс, подъём…) — одним кликом. */
export function TextView() {
  return (
    <RecipeView
      title="Текст"
      tiles={effectsTiles().text}
      hints={{ Текст: "Выделите текст (или любой клип) и нажмите — применится сразу. Анимируется весь слой: по буквам Premiere не даёт." }}
      storeKey="textSelected"
    />
  );
}

export function EffectsView() {
  return (
    <RecipeView
      title="Эффекты"
      groupOrder={["Удары", "Создать", "Стиль", "Картинка", "Свечение", "Углы", "Мои"]}
      tiles={effectsTiles().main}
      hints={{
        Картинка: "«Убрать фон»: выделите картинку или видеоклип — первый раз панель предложит скачать нейросеть (~210 МБ).",
        Удары: "Поставьте плейхед на бит, выделите клипы и нажмите — акцент на 3–8 кадров.",
        Создать: "Под плейхед на свободную дорожку над V1; выделены клипы — на их длину. Adjustment Layer: один раз File → New → Adjustment Layer.",
        Свечение: "«Контур» и «Неон» — для PNG, текста, логотипов.",
        Мои: "Сохраняются с клипа: «Пресеты → Эффекты → Сохранить с клипа».",
      }}
      storeKey="fxSelected"
    />
  );
}

export function ColorView() {
  return (
    <RecipeView
      title="Цвет"

      tiles={recipeTiles(COLOR_RECIPES)}
      withStrength
      hints={{}}
      storeKey="colorSelected"
    />
  );
}

const ALL = "Все";
const GAP = 6;
const LABEL_H = 18;

/** Размер плитки, при котором всё помещается без прокрутки (от 104 до 52 px). */
function fitTile(w: number, h: number, counts: number[]): number {
  if (!w || !h) return 92;
  for (let s = 104; s >= 52; s -= 4) {
    const cols = Math.max(1, Math.floor((w + GAP) / (s + GAP)));
    const nameH = s >= 80 ? 18 : 14;
    const tileH = Math.round((s * 9) / 16) + nameH + 8;
    const total = counts.reduce((n, c) => n + Math.ceil(c / cols) * (tileH + GAP) + LABEL_H, 0);
    if (total <= h) return s;
  }
  return 52;
}

function RecipeView(props: { title: string; tiles: Tile[]; withStrength?: boolean; hints: Record<string, string>; storeKey: string; groupOrder?: string[] }) {
  const [sel, setSel] = useState<string | null>(() => storageGet(props.storeKey));
  const [strength, setStrength] = useState(() => Number(storageGet(`${props.storeKey}:strength`)) || 100);
  const [status, setStatus] = useState<Status>(null);
  const chosen = props.tiles.find((t) => t.key === sel) ?? null;
  const present = new Set(props.tiles.map((t) => t.group));
  const groups = [...(props.groupOrder ?? []).filter((g) => present.has(g)), ...[...present].filter((g) => !props.groupOrder?.includes(g))];
  const [group, setGroup] = useState<string>(() => {
    const g = storageGet(`${props.storeKey}:group`);
    return g && present.has(g) ? g : groups[0] ?? ALL;
  });
  // Один раздел на экране (без «Все»): меньше плиток — проще найти, всё без прокрутки.
  const visible = present.has(group) ? [group] : groups.slice(0, 1);
  const [areaRef, area] = useSize();
  const contentRef = useRef<HTMLDivElement>(null);
  const size = useFitTiles(area, fitTile(area.w, area.h, visible.map((g) => props.tiles.filter((t) => t.group === g).length)), contentRef, [group]);
  const small = size < 80;

  const apply = async (tile: Tile | null = chosen) => {
    if (!tile) return;
    setStatus({ tone: "busy", text: `Применяю «${tile.name}»…` });
    try {
      setStatus({ tone: "ok", text: await tile.run(strength / 100, (text) => setStatus({ tone: "busy", text })) });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };

  return (
    <div className="pv">
      <div className="recipe-head">
        <div className="lib-chips recipe-chips">
          {groups.map((g) => (
            <div
              key={g}
              className={`lib-chip${g === visible[0] ? " is-active" : ""}`}
              onClick={() => {
                setGroup(g);
                storageSet(`${props.storeKey}:group`, g);
              }}
            >
              {g}
            </div>
          ))}
        </div>
        {props.withStrength ? (
          <div className="recipe-strength">
            <Slider
              label="Сила"
              value={strength}
              min={10}
              max={150}
              step={5}
              unit="%"
              onChange={(v) => {
                setStrength(v);
                storageSet(`${props.storeKey}:strength`, String(v));
              }}
            />
          </div>
        ) : null}
      </div>
      <div className="recipe-area" ref={areaRef}>
        <div ref={contentRef}>
        <div className="recipe-grid">
          {visible.map((g) => [
            ...props.tiles
              .filter((t) => t.group === g)
              .map((t) => (
                <div
                  key={t.key}
                  className={`recipe-tile${small ? " is-small" : ""}${t.key === sel ? " is-active" : ""}`}
                  style={{ width: size }}
                  onClick={() => {
                    setSel(t.key);
                    storageSet(props.storeKey, t.key);
                    // Клик — сразу применить (одинаково для всех плиток; Ctrl+Z — отмена).
                    void apply(t);
                  }}
                  title={`${t.name}: ${t.desc}`}
                >
                  {t.thumb ? (
                    <img className="recipe-thumb" src={t.thumb} alt="" style={{ width: size - 6, height: Math.round(((size - 6) * 9) / 16) }} />
                  ) : (
                    <div
                      className="recipe-thumb"
                      style={{ width: size - 6, height: Math.round(((size - 6) * 9) / 16), backgroundColor: t.swatch[1], backgroundImage: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }}
                    />
                  )}
                  <div className="recipe-name">{t.name}</div>
                </div>
              )),
          ])}
        </div>
        </div>
      </div>
      <div className="pv-footer">
        <span className={`pv-footer-text${status ? ` status-${status.tone}` : ""}`}>
          {status ? status.text : props.hints[visible[0]] ?? "Выделите клипы и кликните плитку — применится сразу. Отмена — Ctrl+Z."}
        </span>
      </div>
    </div>
  );
}
