import { storageGet, storageSet } from "../env.ts";
import { animateSelected } from "../automation/animate.ts";
import { flashSelected } from "../automation/flash.ts";
import { applyRecipe } from "../automation/fxRecipes.ts";
import { applyQuickEase, bakeCurve, unbakeCurve } from "../automation/graph.ts";
import { applyHit, HITS } from "../automation/hits.ts";
import { closeGaps, placeOnMarkers, setDuration, toggleEnabled } from "../automation/montage.ts";
import { nestSelected, unnestSelected } from "../automation/nest.ts";
import { adjustmentLayer, adjustmentWithTransform, blackVideo, colorMatte } from "../automation/quickCreate.ts";
import { removeBackgroundSelected } from "../automation/removeBg.ts";
import { changeLevel, duckMusic, fades } from "../automation/sound.ts";
import { copyStyle, pasteStyle } from "../automation/textStyle.ts";
import { addTransitions, type TransitionKind } from "../automation/transitions.ts";
import { textReveal, TEXT_REVEALS } from "../automation/textReveal.ts";
import { createProjectBins } from "../automation/projectBins.ts";
import { applyTrackTemplate } from "../automation/trackTemplate.ts";
import { GRAPHICS } from "../graphics/elements.ts";
import { insertGraphic } from "../graphics/insert.ts";
import { loadAnimOptions } from "../presets/animations.ts";
import { CURVE_PRESETS } from "../presets/curves.ts";
import { COLOR_RECIPES, FX_RECIPES } from "../presets/fxLibrary.ts";
import { LIBRARY } from "../presets/library.ts";

/**
 * Палитра команд: всё, что умеет панель, — одним списком для поиска по названию (как FX Console / Excalibur).
 * Команда либо делает действие сразу (с настройками, сохранёнными на вкладках), либо открывает вкладку.
 */

export interface Command {
  id: string;
  title: string;
  group: string;
  keywords?: string;
  run?: (report: (t: string) => void) => Promise<string>;
  /** Открыть вкладку вместо действия. */
  tab?: string;
}

const num = (key: string, def: number) => {
  const v = Number(storageGet(key));
  return Number.isFinite(v) && storageGet(key) !== null ? v : def;
};

const said = (name: string, n: number) => `«${name}» — ${n} клип. Отмена — Ctrl+Z.`;

export function buildCommands(): Command[] {
  const cmds: Command[] = [];
  const add = (c: Command) => cmds.push(c);

  // Вкладки
  for (const [id, title, kw] of [
    ["chat", "Чат с ассистентом", "ии спросить"],
    ["effects", "Эффекты", "пачки стиль"],
    ["elements", "Элементы: стрелки, линии, плашки", "графика"],
    ["montage", "Монтаж", "резка"],
    ["titles", "Титры (.mogrt)", "шаблоны текст"],
    ["presets", "Пресеты анимаций", "движение"],
    ["graph", "Графики плавности", "кривые ease"],
    ["color", "Цвет (Lumetri)", "цветокор"],
    ["sound", "Звук", "громкость"],
    ["auto", "Авто: покраска, маркеры, папки", "label"],
    ["settings", "Настройки", "ключ обновление"],
  ] as const) {
    add({ id: `tab-${id}`, title: `Открыть: ${title}`, group: "Вкладки", keywords: kw, tab: id });
  }

  // ИИ
  add({ id: "ai-removebg", title: "Убрать фон (фото или видео)", group: "ИИ", keywords: "remove background вырезать хромакей", run: (r) => removeBackgroundSelected(r) });

  // Удары
  for (const h of HITS) add({ id: h.id, title: `Удар: ${h.name}`, group: "Удары", keywords: `${h.desc} hit бит ${h.id.replace("hit-", "").replace(/-/g, " ")}`, run: () => applyHit(h.id) });
  add({ id: "flash-bright", title: "Вспышка (4 кадра)", group: "Удары", keywords: "flash свет", run: () => flashSelected("bright", 4) });
  add({ id: "flash-glow", title: "Блик контура (PNG/текст)", group: "Удары", keywords: "glow свечение", run: () => flashSelected("glow", 4) });

  // Создать
  add({ id: "create-black", title: "Создать Black Video", group: "Создать", keywords: "чёрный фон", run: blackVideo });
  add({ id: "create-white", title: "Создать белый фон (Color Matte)", group: "Создать", keywords: "color matte колор мейт", run: () => colorMatte("#ffffff") });
  add({ id: "create-green", title: "Создать хромакей (Color Matte)", group: "Создать", keywords: "green зелёный", run: () => colorMatte("#00b140") });
  for (const [id, name, hex] of [["red", "красный", "#ff3b30"], ["yellow", "жёлтый", "#ffd60a"], ["blue", "синий", "#0a84ff"], ["pink", "розовый", "#ff4fa3"], ["gray", "серый", "#808080"], ["purple", "фиолетовый", "#9f18ec"]])
    add({ id: `create-${id}`, title: `Создать ${name} фон (Color Matte)`, group: "Создать", keywords: "color matte колор мейт плашка", run: () => colorMatte(hex) });
  for (const r of TEXT_REVEALS) add({ id: `txt-${r.id}`, title: `Текст: ${r.name}`, group: "Текст", keywords: `${r.desc} typewriter печать шторка`, run: () => textReveal(r.id) });
  add({ id: "proj-start", title: "Подготовить проект (папки + дорожки)", group: "Проект", keywords: "старт новый проект папки bins дорожки треки названия voice music sfx", run: async () => `${await createProjectBins()} ${(await applyTrackTemplate()).text}` });
  add({ id: "proj-tracks", title: "Назвать дорожки по шаблону", group: "Проект", keywords: "дорожки треки названия voice music sfx video graphics", run: async () => (await applyTrackTemplate()).text });
  add({ id: "proj-bins", title: "Создать папки проекта", group: "Проект", keywords: "bins папки структура материалы аудио графика архив новый проект", run: () => createProjectBins() });
  add({ id: "create-adjust", title: "Положить Adjustment Layer", group: "Создать", keywords: "корректирующий слой", run: adjustmentLayer });
  add({ id: "create-adjust-tf", title: "Adjustment Layer + Transform (блюр 360)", group: "Создать", keywords: "корректирующий motion blur", run: adjustmentWithTransform });

  // Эффекты и цвет
  for (const r of FX_RECIPES) add({ id: `fx-${r.id}`, title: `Эффект: ${r.name}`, group: "Эффекты", keywords: `${r.desc} ${r.group}`, run: async () => said(r.name, (await applyRecipe(r, 1)).clips) });
  for (const r of COLOR_RECIPES) add({ id: `color-${r.id}`, title: `Цвет: ${r.name}`, group: "Цвет", keywords: `${r.desc} lumetri`, run: async () => said(r.name, (await applyRecipe(r, num("colorSelected:strength", 100) / 100)).clips) });

  // Анимации
  for (const a of LIBRARY) add({ id: `anim-${a.id}`, title: `Анимация: ${a.name}`, group: `Анимации · ${a.category ?? ""}`, keywords: "движение пресет", run: async () => said(a.name, (await animateSelected(a, loadAnimOptions())).changed) });

  // Элементы
  const el = () => ({
    color: JSON.parse(storageGet("elColor") || '"#ffffff"'),
    dir: JSON.parse(storageGet("elDir") || '"right"'),
    anim: JSON.parse(storageGet("elAnim") || '"draw"'),
    seconds: JSON.parse(storageGet("elSecs") || "3"),
  });
  for (const g of GRAPHICS) add({ id: `el-${g.id}`, title: `Элемент: ${g.name}`, group: `Элементы · ${g.neon ? "GTA растер · " : ""}${g.group}`, keywords: `графика вставить${g.neon ? " gta гта растер неон vice city" : ""}`, run: () => insertGraphic(g.id, el()) });

  // Ключи
  const curve = (id: string) => CURVE_PRESETS.find((c) => c.id === id)!.curve;
  add({ id: "key-launch", title: "Ключи: быстрый вылет", group: "Ключи", keywords: "ease speed graph", run: async () => `Быстрый вылет: +${(await bakeCurve(curve("fast-launch"), { step: 0, scope: "all", shape: "launch" })).keys} ключ.` });
  add({ id: "key-trampoline", title: "Ключи: трамплин", group: "Ключи", keywords: "ease speed graph", run: async () => `Трамплин: +${(await bakeCurve(curve("trampoline"), { step: 0, scope: "all", shape: "trampoline" })).keys} ключ.` });
  add({ id: "key-smooth", title: "Ключи: плавно (Bezier)", group: "Ключи", keywords: "ease bezier", run: async () => `Bezier: ключей ${(await applyQuickEase("bezier", "all")).keys}.` });
  add({ id: "key-linear", title: "Ключи: линейно (Linear)", group: "Ключи", keywords: "linear", run: async () => `Linear: ключей ${(await applyQuickEase("linear", "all")).keys}.` });
  add({ id: "key-unbake", title: "Ключи: убрать доп. ключи", group: "Ключи", keywords: "очистить", run: async () => `Убрано: ${(await unbakeCurve(true)).removed}.` });

  // Монтаж
  add({ id: "m-gaps", title: "Убрать пустоты", group: "Монтаж", keywords: "gaps вплотную", run: async () => `Сдвинуто: ${(await closeGaps()).changed}.` });
  add({ id: "m-markers", title: "Разложить по маркерам", group: "Монтаж", keywords: "бит markers", run: async () => `Разложено: ${(await placeOnMarkers(storageGet("montageTrim") !== "0")).changed}.` });
  add({ id: "m-duration", title: `Одинаковая длина (${num("montageDur", 2).toFixed(1)} с)`, group: "Монтаж", keywords: "duration длительность", run: async () => `Длина — клипов: ${(await setDuration(num("montageDur", 2), storageGet("montagePack") !== "0")).changed}.` });
  add({ id: "m-toggle", title: "Выключить / включить клипы", group: "Монтаж", keywords: "disable enable shift+e", run: async () => `Переключено: ${(await toggleEnabled()).changed}.` });
  add({ id: "m-nest", title: "Nest — собрать во вложенную", group: "Монтаж", keywords: "вложенная секвенция", run: () => nestSelected() });
  add({ id: "m-unnest", title: "Разобрать Nest", group: "Монтаж", keywords: "unnest", run: () => unnestSelected() });
  add({ id: "m-copy-style", title: "Копировать стиль", group: "Монтаж", keywords: "текст шрифт", run: () => copyStyle() });
  add({ id: "m-paste-style", title: "Вставить стиль на выделенные", group: "Монтаж", keywords: "текст шрифт", run: () => pasteStyle() });
  add({ id: "m-pauses", title: "Вырезать паузы…", group: "Монтаж", keywords: "тишина silence jump cut", tab: "montage" });
  add({ id: "m-subs", title: "Субтитры…", group: "Монтаж", keywords: "subtitles captions речь", tab: "montage" });
  add({ id: "m-beats", title: "Монтаж под бит…", group: "Монтаж", keywords: "beat bpm ритм", tab: "montage" });
  add({ id: "m-cams", title: "Переключение камер (подкаст)…", group: "Монтаж", keywords: "multicam мультикамера интервью", tab: "montage" });
  for (const [k, name] of [
    ["dissolve", "Cross Dissolve"],
    ["black", "Dip to Black"],
    ["white", "Dip to White"],
    ["film", "Film Dissolve"],
  ] as const) {
    add({ id: `tr-${k}`, title: `Переходы на стыки: ${name}`, group: "Монтаж", keywords: "transition переход", run: async () => `Переходов: ${(await addTransitions({ kind: k as TransitionKind, seconds: 0.5, edges: false })).added}.` });
  }

  // Звук
  for (const d of [-6, -3, 3, 6]) add({ id: `snd-${d}`, title: `Громкость ${d > 0 ? "+" : ""}${d} дБ`, group: "Звук", keywords: "volume level", run: async () => `${d > 0 ? "+" : ""}${d} дБ — клипов: ${(await changeLevel({ delta: d })).clips}.` });
  add({ id: "snd-fades", title: "Фейды на звук", group: "Звук", keywords: "fade появление затухание", run: async () => `Фейды — клипов: ${(await fades(num("soundFadeIn", 0.5), num("soundFadeOut", 1))).clips}.` });
  add({ id: "snd-duck", title: "Приглушить музыку под голосом", group: "Звук", keywords: "ducking", run: async () => `Фраз: ${(await duckMusic(num("soundDuck", -12), num("soundDuckFade", 0.3))).voiceParts}.` });

  return cmds;
}

// ───────── Поиск ─────────

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = "йцукенгшщзхъфывапролджэячсмитьбюё";

/** Текст, набранный не в той раскладке («ифдф» ↔ «blur»). */
export function swapLayout(s: string): string {
  return [...s.toLowerCase()]
    .map((ch) => {
      const i = EN.indexOf(ch);
      if (i >= 0) return RU[i];
      const j = RU.indexOf(ch);
      return j >= 0 ? EN[j] : ch;
    })
    .join("");
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[«»"/]/g, "");

function score(hay: string, q: string, subseq = true): number {
  if (!q) return 0;
  const h = norm(hay);
  const n = norm(q);
  const words = h.split(/[\s:·()/,.-]+/);
  if (words.some((w) => w.startsWith(n))) return 100 - Math.min(40, h.indexOf(n));
  if (h.includes(n)) return 60 - Math.min(30, h.indexOf(n));
  // Все слова запроса встречаются
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => h.includes(p))) return 50;
  // Подпоследовательность («блрд» → «блюр-удар») — только по названию и для запросов от 3 букв.
  if (!subseq || n.length < 3) return -1;
  let i = 0;
  for (const ch of h) if (ch === n[i]) i++;
  return i === n.length ? 20 : -1;
}

const RECENT_KEY = "paletteRecent";

export function recentIds(): string[] {
  try {
    const v = JSON.parse(storageGet(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function rememberCommand(id: string): void {
  storageSet(RECENT_KEY, JSON.stringify([id, ...recentIds().filter((x) => x !== id)].slice(0, 8)));
}

export function searchCommands(cmds: Command[], query: string, limit = 9): Command[] {
  const q = query.trim();
  if (!q) {
    const rec = recentIds()
      .map((id) => cmds.find((c) => c.id === id))
      .filter(Boolean) as Command[];
    return rec.length ? rec.slice(0, limit) : cmds.filter((c) => c.group !== "Вкладки").slice(0, limit);
  }
  const alt = swapLayout(q);
  const rec = recentIds();
  return cmds
    .map((c) => {
      const text = `${c.title} ${c.group} ${c.keywords ?? ""}`;
      const plus = (v: number, b: number) => (v > 0 ? v + b : -1);
      const s = Math.max(plus(score(c.title, q), 10), score(text, q, false), plus(score(c.title, alt), 5), plus(score(text, alt, false), -5));
      return { c, s: s + (rec.includes(c.id) ? 8 : 0) };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .filter((x, _, all) => !(all[0].s >= 40 && x.s < 30)) // есть точные совпадения — без «по буквам»
    .slice(0, limit)
    .map((x) => x.c);
}
