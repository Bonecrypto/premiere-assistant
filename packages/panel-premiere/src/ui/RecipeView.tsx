import { useState } from "react";
import { animateSelected } from "../automation/animate.ts";
import { applyFxPreset, loadFxPresets } from "../automation/fxPresets.ts";
import { applyRecipe, type FxRecipe } from "../automation/fxRecipes.ts";
import { applyQuickEase, bakeCurve, unbakeCurve } from "../automation/graph.ts";
import { CURVE_PRESETS } from "../presets/curves.ts";
import { storageGet, storageSet } from "../env.ts";
import { loadAnimOptions } from "../presets/animations.ts";
import { COLOR_RECIPES, FX_MOTION, FX_RECIPES } from "../presets/fxLibrary.ts";
import { LIBRARY } from "../presets/library.ts";
import { adjustmentLayer, blackVideo, colorMatte } from "../automation/quickCreate.ts";
import { Button } from "./Button.tsx";
import { FX_THUMBS } from "./fxThumbs.ts";
import { Slider } from "./Slider.tsx";

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
  run(strength: number): Promise<string>;
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

/** Кривые «одним кликом» для ключей, которые пользователь поставил сам. */
const KEY_CURVES: Array<{ id: string; name: string; desc: string; swatch: [string, string]; quick?: "launch" | "trampoline" | "bezier" }> = [
  { id: "launch", name: "Быстрый вылет", desc: "Без новых ключей: старт сразу на скорости, мягкое торможение", swatch: ["#ff5e3a", "#7a1cf0"], quick: "launch" },
  { id: "trampoline", name: "Трамплин", desc: "Без новых ключей: мягкий разгон, вылет на скорости в конце", swatch: ["#7a1cf0", "#ff5e3a"], quick: "trampoline" },
  { id: "smooth", name: "Плавно", desc: "Без новых ключей: мягкий старт и остановка (Bezier)", swatch: ["#5a6fe8", "#2d9ee0"], quick: "bezier" },
  { id: "fast-launch", name: "Вылет — точно", desc: "Максимальная скорость на старте: +1–3 доп. ключа по кривой", swatch: ["#ff2d55", "#4b0cb4"] },
  { id: "trampoline-exact", name: "Трамплин — точно", desc: "Резкий вылет в самом конце: +1–3 доп. ключа", swatch: ["#4b0cb4", "#ff2d55"] },
  { id: "unbake", name: "Убрать", desc: "Убрать доп. ключи, вернуть Bezier", swatch: ["#3a3a44", "#1a1a20"] },
];

/** «Создать»: элементы на таймлайн одним кликом. */
const CREATE: Array<{ id: string; name: string; desc: string; run: () => Promise<string> }> = [
  { id: "create-black", name: "Black Video", desc: "Чёрный кадр на свободную дорожку", run: blackVideo },
  { id: "create-adjust", name: "Adjustment Layer", desc: "Корректирующий слой — эффекты на всё ниже", run: adjustmentLayer },
  { id: "create-white", name: "Белый фон", desc: "Color Matte белого цвета", run: () => colorMatte("#ffffff") },
  { id: "create-green", name: "Хромакей", desc: "Зелёная плашка (Color Matte)", run: () => colorMatte("#00b140") },
  { id: "create-purple", name: "Фиолетовая", desc: "Color Matte фирменного цвета", run: () => colorMatte("#9f18ec") },
];

/** Плотность ключей — как выбрано во вкладке «Графики» (по умолчанию «мало»). */
function graphStep(): 0 | 1 | 2 {
  try {
    const v = JSON.parse(storageGet("graphOptions") || "null");
    if (v && (v.step === 0 || v.step === 1 || v.step === 2)) return v.step;
  } catch {
    /* по умолчанию */
  }
  return 0;
}

/** Плитки вкладки «Эффекты»: пачки + движение + свои пачки из «Пресеты → Эффекты». */
function effectsTiles(): Tile[] {
  const motion: Tile[] = FX_MOTION.map((m) => ({
    key: m.id,
    name: m.name,
    desc: m.desc,
    group: "Движение",
    swatch: ["#9f18ec", "#4b0cb4"],
    thumb: FX_THUMBS[m.id],
    run: async () => {
      const preset = LIBRARY.find((a) => a.id === m.anim);
      if (!preset) throw new Error("Не нашёл анимацию.");
      const r = await animateSelected(preset, loadAnimOptions());
      return `«${m.name}» — ${r.changed} клип. Отмена — Ctrl+Z.`;
    },
  }));
  const mine: Tile[] = loadFxPresets().map((f) => ({
    key: `my-${f.id}`,
    name: f.name,
    desc: `${f.components.length} эфф. · ${f.kind === "video" ? "видео" : "звук"}`,
    group: "Мои пачки",
    swatch: ["#2a2a35", "#15151b"],
    thumb: FX_THUMBS.mine,
    run: async () => {
      const r = await applyFxPreset(f);
      return `«${f.name}» — ${r.changed} клип. Отмена — Ctrl+Z (2 раза).`;
    },
  }));
  const keys: Tile[] = KEY_CURVES.map((k) => ({
    key: k.id,
    name: k.name,
    desc: k.desc,
    group: "Ключи — ваши ключи в Effect Controls",
    swatch: k.swatch,
    thumb: FX_THUMBS[k.id],
    instant: true,
    run: async () => {
      if (k.id === "unbake") {
        const r = await unbakeCurve();
        return `Убрано доп. ключей: ${r.removed}. Ваши ключи остались.`;
      }
      if (k.quick) {
        const r = await applyQuickEase(k.quick, "all");
        return `«${k.name}»: ключей ${r.keys} у ${r.params} парам. — новых ключей нет. Отмена — Ctrl+Z.`;
      }
      const curveId = k.id === "trampoline-exact" ? "trampoline" : k.id;
      const curve = CURVE_PRESETS.find((c) => c.id === curveId)!.curve;
      const r = await bakeCurve(curve, { step: graphStep(), scope: "all" });
      const skip = r.skipped.length ? ` Пропущено: ${r.skipped[0]}.` : "";
      return `«${k.name}»: ${r.segments} отрезк. у ${r.params} парам. Отмена — Ctrl+Z.${skip}`;
    },
  }));
  const create: Tile[] = CREATE.map((c) => ({
    key: c.id,
    name: c.name,
    desc: c.desc,
    group: "Создать — под плейхед или на длину выделенных",
    swatch: ["#000000", "#000000"],
    thumb: FX_THUMBS[c.id],
    instant: true,
    run: c.run,
  }));
  return [...create, ...keys, ...recipeTiles(FX_RECIPES), ...motion, ...mine];
}

export function EffectsView() {
  return (
    <RecipeView
      title="Эффекты"
      sub="Готовые пачки из стандартных эффектов Premiere — выделите клипы и примените."
      tiles={effectsTiles()}
      hint="«Создать»: клик кладёт элемент под плейхед на свободную дорожку над V1; если выделены клипы — накрывает их по длине. Adjustment Layer берётся из проекта — создайте его один раз (File → New → Adjustment Layer). «Свечение контура» и «Неон» — для PNG, текста, логотипов. «Ключи»: поставьте ключи в Effect Controls (например, Position), выделите клип и нажмите плитку — применится сразу. «Быстрый вылет», «Трамплин», «Плавно» меняют только тип ваших ключей (Linear/Bezier), новых не создают. Максимальная скорость, как если тянуть ручку в Speed Graph, плагину недоступна — для неё «… — точно»: +1–3 доп. ключа по кривой; «Убрать» возвращает как было. Свою пачку эффектов можно сохранить с клипа: «Пресеты → Эффекты → Сохранить с клипа»."
      storeKey="fxSelected"
    />
  );
}

export function ColorView() {
  return (
    <RecipeView
      title="Цвет"
      sub="Пресеты Lumetri Color в один клик. Если Lumetri уже есть на клипе — он перенастраивается."
      tiles={recipeTiles(COLOR_RECIPES)}
      withStrength
      hint="Тонкая настройка — как обычно, в панели Lumetri Color: все значения остаются редактируемыми."
      storeKey="colorSelected"
    />
  );
}

function RecipeView(props: { title: string; sub: string; tiles: Tile[]; withStrength?: boolean; hint: string; storeKey: string }) {
  const [sel, setSel] = useState<string | null>(() => storageGet(props.storeKey));
  const [strength, setStrength] = useState(() => Number(storageGet(`${props.storeKey}:strength`)) || 100);
  const [status, setStatus] = useState<Status>(null);
  const chosen = props.tiles.find((t) => t.key === sel) ?? null;
  const groups = [...new Set(props.tiles.map((t) => t.group))];

  const apply = async (tile: Tile | null = chosen) => {
    if (!tile) return;
    setStatus({ tone: "busy", text: `Применяю «${tile.name}»…` });
    try {
      setStatus({ tone: "ok", text: await tile.run(strength / 100) });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };

  return (
    <div className="pv">
      <div className="page">
        <div className="scroll-inner">
          <div className="page-title">{props.title}</div>
          <div className="page-sub">{props.sub}</div>
          {props.withStrength ? (
            <div className="hero-card recipe-strength">
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
          {groups.map((g) => (
            <div key={g} className="recipe-group">
              <div className="pv-group">{g}</div>
              <div className="recipe-grid">
                {props.tiles
                  .filter((t) => t.group === g)
                  .map((t) => (
                    <div
                      key={t.key}
                      className={`recipe-tile${t.key === sel ? " is-active" : ""}`}
                      onClick={() => {
                        setSel(t.key);
                        storageSet(props.storeKey, t.key);
                        if (t.instant) void apply(t);
                        else setStatus(null);
                      }}
                      onDoubleClick={() => !t.instant && void apply(t)}
                      title={t.desc}
                    >
                      {t.thumb ? (
                        <img className="recipe-swatch recipe-thumb" src={t.thumb} alt="" />
                      ) : (
                        <div className="recipe-swatch" style={{ backgroundColor: t.swatch[1], backgroundImage: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }} />
                      )}
                      <div className="recipe-name">{t.name}</div>
                      <div className="recipe-desc">{t.desc}</div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
          <div className="pv-hint-block recipe-hint">{props.hint}</div>
        </div>
      </div>
      <div className="pv-footer">
        <span className={`pv-footer-text${status ? ` status-${status.tone}` : ""}`}>
          {status ? status.text : chosen ? `${chosen.name} — выделите клипы и «Применить» (или двойной клик)` : "Выберите плитку"}
        </span>
        <Button variant="primary" className="pv-apply" onClick={() => void apply()} disabled={!chosen || status?.tone === "busy"}>
          Применить
        </Button>
      </div>
    </div>
  );
}
