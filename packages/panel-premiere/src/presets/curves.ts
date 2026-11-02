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
  group: "Базовые" | "Мягкие" | "Резкие" | "С перелётом" | "Мои";
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
