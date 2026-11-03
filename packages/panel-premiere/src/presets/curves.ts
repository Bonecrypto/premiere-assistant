import { storageGet, storageSet } from "../env.ts";

/**
 * Кривые плавности (как cubic-bezier в CSS / графики скорости в Flow).
 * [x1, y1, x2, y2] — две «ручки»; x в пределах 0…1, y может выходить за 0…1 (перелёт).
 */
export type Curve = [number, number, number, number];

export interface CurvePreset {
  id: string;
  name: string;
  curve: Curve;
  group: "Базовые" | "Мягкие" | "Резкие" | "С перелётом" | "Классика" | "Мои";
}

export const CURVE_PRESETS: CurvePreset[] = [
  { id: "linear", name: "Линейно", curve: [0, 0, 1, 1], group: "Базовые" },
  { id: "ease", name: "Плавно", curve: [0.25, 0.1, 0.25, 1], group: "Базовые" },
  { id: "in", name: "Разгон", curve: [0.42, 0, 1, 1], group: "Базовые" },
  { id: "out", name: "Торможение", curve: [0, 0, 0.58, 1], group: "Базовые" },
  { id: "inout", name: "Разгон и торможение", curve: [0.42, 0, 0.58, 1], group: "Базовые" },

  { id: "apple", name: "Apple", curve: [0.32, 0.72, 0, 1], group: "Мягкие" },
  { id: "smooth-out", name: "Мягкий выход", curve: [0.16, 1, 0.3, 1], group: "Мягкие" },
  { id: "smooth-inout", name: "Мягко туда-сюда", curve: [0.65, 0, 0.35, 1], group: "Мягкие" },
  { id: "sine", name: "Синус", curve: [0.37, 0, 0.63, 1], group: "Мягкие" },

  { id: "fast-launch", name: "Быстрый вылет", curve: [0.05, 0.85, 0.1, 1], group: "Резкие" },
  { id: "trampoline", name: "Трамплин", curve: [0.9, 0, 0.95, 0.15], group: "Резкие" },
  { id: "expo-out", name: "Выстрел", curve: [0.19, 1, 0.22, 1], group: "Резкие" },
  { id: "expo-in", name: "Втягивание", curve: [0.95, 0.05, 0.795, 0.035], group: "Резкие" },
  { id: "expo-inout", name: "Рывок", curve: [0.87, 0, 0.13, 1], group: "Резкие" },
  { id: "snap", name: "Щелчок", curve: [0.9, 0, 0.1, 1], group: "Резкие" },

  { id: "back-out", name: "Перелёт", curve: [0.34, 1.56, 0.64, 1], group: "С перелётом" },
  { id: "back-in", name: "Замах", curve: [0.36, 0, 0.66, -0.56], group: "С перелётом" },
  { id: "back-inout", name: "Замах и перелёт", curve: [0.68, -0.6, 0.32, 1.6], group: "С перелётом" },
  { id: "pop", name: "Поп", curve: [0.175, 0.885, 0.32, 1.4], group: "С перелётом" },

  // Стандартный набор (Penner / easings.net): In — разгон, Out — торможение, InOut — оба.
  { id: "std-sine-in", name: "Sine In", curve: [0.12, 0, 0.39, 0], group: "Классика" },
  { id: "std-sine-out", name: "Sine Out", curve: [0.61, 1, 0.88, 1], group: "Классика" },
  { id: "std-sine-inout", name: "Sine InOut", curve: [0.37, 0, 0.63, 1], group: "Классика" },
  { id: "std-quad-in", name: "Quad In", curve: [0.11, 0, 0.5, 0], group: "Классика" },
  { id: "std-quad-out", name: "Quad Out", curve: [0.5, 1, 0.89, 1], group: "Классика" },
  { id: "std-quad-inout", name: "Quad InOut", curve: [0.45, 0, 0.55, 1], group: "Классика" },
  { id: "std-cubic-in", name: "Cubic In", curve: [0.32, 0, 0.67, 0], group: "Классика" },
  { id: "std-cubic-out", name: "Cubic Out", curve: [0.33, 1, 0.68, 1], group: "Классика" },
  { id: "std-cubic-inout", name: "Cubic InOut", curve: [0.65, 0, 0.35, 1], group: "Классика" },
  { id: "std-quart-in", name: "Quart In", curve: [0.5, 0, 0.75, 0], group: "Классика" },
  { id: "std-quart-out", name: "Quart Out", curve: [0.25, 1, 0.5, 1], group: "Классика" },
  { id: "std-quart-inout", name: "Quart InOut", curve: [0.76, 0, 0.24, 1], group: "Классика" },
  { id: "std-quint-in", name: "Quint In", curve: [0.64, 0, 0.78, 0], group: "Классика" },
  { id: "std-quint-out", name: "Quint Out", curve: [0.22, 1, 0.36, 1], group: "Классика" },
  { id: "std-quint-inout", name: "Quint InOut", curve: [0.83, 0, 0.17, 1], group: "Классика" },
  { id: "std-expo-in", name: "Expo In", curve: [0.7, 0, 0.84, 0], group: "Классика" },
  { id: "std-expo-out", name: "Expo Out", curve: [0.16, 1, 0.3, 1], group: "Классика" },
  { id: "std-expo-inout", name: "Expo InOut", curve: [0.87, 0, 0.13, 1], group: "Классика" },
  { id: "std-circ-in", name: "Circ In", curve: [0.55, 0, 1, 0.45], group: "Классика" },
  { id: "std-circ-out", name: "Circ Out", curve: [0, 0.55, 0.45, 1], group: "Классика" },
  { id: "std-circ-inout", name: "Circ InOut", curve: [0.85, 0, 0.15, 1], group: "Классика" },
  { id: "std-back-in", name: "Back In", curve: [0.36, 0, 0.66, -0.56], group: "Классика" },
  { id: "std-back-out", name: "Back Out", curve: [0.34, 1.56, 0.64, 1], group: "Классика" },
  { id: "std-back-inout", name: "Back InOut", curve: [0.68, -0.6, 0.32, 1.6], group: "Классика" },
];

/** Функция кривой: доля времени x (0…1) → доля пути y. */
export function easeFn(c: Curve): (x: number) => number {
  const [x1, y1, x2, y2] = c;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Ньютон, потом бисекция для надёжности.
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

export function sameCurve(a: Curve, b: Curve): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) < 0.005);
}

export function curveName(c: Curve): string {
  return CURVE_PRESETS.find((p) => sameCurve(p.curve, c))?.name ?? loadUserCurves().find((p) => sameCurve(p.curve, c))?.name ?? "Своя кривая";
}

/** «0.33, 1, 0.68, 1», «cubic-bezier(.33,1,.68,1)», «33 100 68 100» → кривая (числа больше 2 считаются процентами). */
export function parseCurve(text: string): Curve | null {
  // «0,33; 1; 0,68; 1» — запятая как десятичный знак, если числа разделены «;».
  const t = text.includes(";") ? text.replace(/,/g, ".") : text;
  const nums = (t.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null;
  const pct = nums.some((n) => Math.abs(n) > 2);
  const c = nums.map((n) => (pct ? n / 100 : n)) as Curve;
  if (c[0] < 0 || c[0] > 1 || c[2] < 0 || c[2] > 1) return null;
  return c;
}

export function formatCurve(c: Curve): string {
  return c.map((v) => (Math.round(v * 100) / 100).toString()).join(", ");
}

const USER_KEY = "userCurves";
const LAST_KEY = "lastCurve";

export function loadUserCurves(): CurvePreset[] {
  try {
    const v = JSON.parse(storageGet(USER_KEY) || "[]");
    return Array.isArray(v) ? v.filter((p) => p && Array.isArray(p.curve) && p.curve.length === 4) : [];
  } catch {
    return [];
  }
}

export function saveUserCurves(list: CurvePreset[]): void {
  storageSet(USER_KEY, JSON.stringify(list));
}

export function loadLastCurve(): Curve {
  try {
    const v = JSON.parse(storageGet(LAST_KEY) || "null");
    if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number")) return v as Curve;
  } catch {
    /* по умолчанию */
  }
  return [0.16, 1, 0.3, 1];
}

export function saveLastCurve(c: Curve): void {
  storageSet(LAST_KEY, JSON.stringify(c));
}

export function findCurvePreset(idOrName: string): Curve | null {
  const q = idOrName.trim().toLowerCase();
  const p = [...CURVE_PRESETS, ...loadUserCurves()].find((x) => x.id === q || x.name.toLowerCase() === q);
  return p ? p.curve : null;
}
