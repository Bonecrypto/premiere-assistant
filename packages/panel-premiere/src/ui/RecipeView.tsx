import { useState } from "react";
import { animateSelected } from "../automation/animate.ts";
import { applyFxPreset, loadFxPresets } from "../automation/fxPresets.ts";
import { applyRecipe, type FxRecipe } from "../automation/fxRecipes.ts";
import { storageGet, storageSet } from "../env.ts";
import { loadAnimOptions } from "../presets/animations.ts";
import { COLOR_RECIPES, FX_MOTION, FX_RECIPES } from "../presets/fxLibrary.ts";
import { LIBRARY } from "../presets/library.ts";
import { Button } from "./Button.tsx";
import { Slider } from "./Slider.tsx";

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

interface Tile {
  key: string;
  name: string;
  desc: string;
  group: string;
  /** Цвета миниатюры (градиент). */
  swatch: [string, string];
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
    run: async (strength) => {
      const res = await applyRecipe(r, strength);
      const miss = res.missing.length ? ` Не нашёл: ${res.missing.slice(0, 3).join(", ")}.` : "";
      return `«${r.name}» — ${res.clips} клип. Отмена — Ctrl+Z.${miss}`;
    },
  }));
}

/** Плитки вкладки «Эффекты»: пачки + движение + свои пачки из «Пресеты → Эффекты». */
function effectsTiles(): Tile[] {
  const motion: Tile[] = FX_MOTION.map((m) => ({
    key: m.id,
    name: m.name,
    desc: m.desc,
    group: "Движение",
    swatch: ["#9f18ec", "#4b0cb4"],
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
    run: async () => {
      const r = await applyFxPreset(f);
      return `«${f.name}» — ${r.changed} клип. Отмена — Ctrl+Z (2 раза).`;
    },
  }));
  return [...recipeTiles(FX_RECIPES), ...motion, ...mine];
}

export function EffectsView() {
  return (
    <RecipeView
      title="Эффекты"
      sub="Готовые пачки из стандартных эффектов Premiere — выделите клипы и примените."
      tiles={effectsTiles()}
      hint="Свою пачку можно сохранить с клипа: «Пресеты → Эффекты → Сохранить с клипа» — она появится здесь в «Мои пачки»."
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

  const apply = async () => {
    if (!chosen) return;
    setStatus({ tone: "busy", text: `Применяю «${chosen.name}»…` });
    try {
      setStatus({ tone: "ok", text: await chosen.run(strength / 100) });
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
                        setStatus(null);
                      }}
                      onDoubleClick={() => void apply()}
                      title={t.desc}
                    >
                      <div className="recipe-swatch" style={{ backgroundColor: t.swatch[1], backgroundImage: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }} />
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
        <Button variant="primary" className="pv-apply" onClick={apply} disabled={!chosen || status?.tone === "busy"}>
          Применить
        </Button>
      </div>
    </div>
  );
}
