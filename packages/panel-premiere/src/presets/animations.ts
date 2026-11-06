import { storageGet, storageSet } from "../env.ts";
import { LIBRARY } from "./library.ts";

/**
 * Анимации-пресеты. Движение делается эффектом Transform (у него есть Shutter Angle → моушн-блюр),
 * ключевые кадры ставятся в начале клипа (влёт), в конце (улёт) или на весь клип (наезд/отъезд).
 */
/** in — в начале клипа, out — в конце, whole — весь клип, both — вход в начале и выход в конце. */
export type AnimKind = "in" | "out" | "whole" | "both";

export interface AnimPreset {
  id: string;
  name: string;
  kind: AnimKind;
  /** Сдвиг в долях кадра: dx = -1 — на ширину кадра влево, dy = 1 — на высоту вниз. */
  dx: number;
  dy: number;
  /** Масштаб в «крайней» точке анимации, % (100 — без изменения). */
  scale: number;
  /** Поворот в «крайней» точке, градусы. */
  rotation: number;
  /** Растворение до прозрачности в «крайней» точке. */
  fade: boolean;
  /** Своя длительность (с); пусто — общая из настроек. */
  duration?: number;
  /** Глиф для плитки. */
  glyph: string;
  /** Свои значения общих настроек (для пользовательских пресетов). */
  easing?: "bezier" | "linear";
  blur?: boolean;
  distance?: number;
  /** «Пружина»: перелёт за конечную точку и возврат, % пути (0 — нет). */
  overshoot?: number;
  /** Размытие (эффект Gaussian Blur) в «крайней» точке, 0 — без размытия. */
  blurAmt?: number;
  /** Тряска: амплитуда в % кадра (0 — нет). Затухает за длительность. */
  shake?: number;
  /** Баунс (как в игровом монтаже): затухающие пружинки после влёта, сила 0…0.8 (0 — нет). */
  bounce?: number;
  /** Покачивание (camera wobble): плавное блуждание положения на весь клип, % кадра (0 — нет). */
  wobble?: number;
  /** Покачивание: поворот, градусы. */
  wobbleRot?: number;
  /** Покачивание: частота, колебаний в секунду. */
  wobbleHz?: number;
  /** Для both: выход в противоположную сторону (проезд через кадр). */
  through?: boolean;
  /** Свой график плавности [x1, y1, x2, y2]; пусто — обычный Bezier Premiere. */
  curve?: [number, number, number, number];
  /** Раздел библиотеки. */
  category?: string;
  builtin?: boolean;
}

export interface AnimOptions {
  /** Длительность влёта/улёта, с. */
  duration: number;
  easing: "bezier" | "linear";
  /** Моушн-блюр: Transform → Shutter Angle 360. */
  blur: boolean;
  /** Насколько далеко улетать, % кадра (100 — ровно за край). */
  distance: number;
}

const B = (p: Omit<AnimPreset, "builtin" | "scale" | "rotation" | "fade"> & Partial<AnimPreset>): AnimPreset => ({
  scale: 100,
  rotation: 0,
  fade: false,
  builtin: true,
  ...p,
});

export const BUILTIN_ANIMS: AnimPreset[] = [
  B({ id: "in-left", name: "Влёт слева", kind: "in", dx: -1, dy: 0, glyph: "→" }),
  B({ id: "in-right", name: "Влёт справа", kind: "in", dx: 1, dy: 0, glyph: "←" }),
  B({ id: "in-top", name: "Влёт сверху", kind: "in", dx: 0, dy: -1, glyph: "↓" }),
  B({ id: "in-bottom", name: "Влёт снизу", kind: "in", dx: 0, dy: 1, glyph: "↑" }),
  B({ id: "out-left", name: "Улёт влево", kind: "out", dx: -1, dy: 0, glyph: "←" }),
  B({ id: "out-right", name: "Улёт вправо", kind: "out", dx: 1, dy: 0, glyph: "→" }),
  B({ id: "out-top", name: "Улёт вверх", kind: "out", dx: 0, dy: -1, glyph: "↑" }),
  B({ id: "out-bottom", name: "Улёт вниз", kind: "out", dx: 0, dy: 1, glyph: "↓" }),
  B({ id: "zoom-in", name: "Наезд", kind: "whole", dx: 0, dy: 0, scale: 115, glyph: "⤢" }),
  B({ id: "zoom-out", name: "Отъезд", kind: "whole", dx: 0, dy: 0, scale: 85, glyph: "⤡" }),
  B({ id: "fade-in", name: "Появление", kind: "in", dx: 0, dy: 0, fade: true, glyph: "◐" }),
  B({ id: "fade-out", name: "Исчезновение", kind: "out", dx: 0, dy: 0, fade: true, glyph: "◑" }),
];

export const DEFAULT_ANIM_OPTIONS: AnimOptions = { duration: 0.3, easing: "bezier", blur: true, distance: 100 };

const OPT_KEY = "animOptions";
const USER_KEY = "userAnims";

export function loadAnimOptions(): AnimOptions {
  try {
    return { ...DEFAULT_ANIM_OPTIONS, ...JSON.parse(storageGet(OPT_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_ANIM_OPTIONS };
  }
}

export function saveAnimOptions(o: AnimOptions): void {
  storageSet(OPT_KEY, JSON.stringify(o));
}

export function loadUserAnims(): AnimPreset[] {
  try {
    const list = JSON.parse(storageGet(USER_KEY) || "[]");
    return Array.isArray(list) ? list.filter((p) => p && p.id && p.name) : [];
  } catch {
    return [];
  }
}

export function saveUserAnims(list: AnimPreset[]): void {
  storageSet(USER_KEY, JSON.stringify(list));
}

export function allAnims(): AnimPreset[] {
  return [...BUILTIN_ANIMS, ...LIBRARY, ...loadUserAnims()];
}

export function findAnim(id: string): AnimPreset | undefined {
  return allAnims().find((a) => a.id === id);
}
