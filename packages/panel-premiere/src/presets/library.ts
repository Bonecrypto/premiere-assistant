import type { AnimPreset } from "./animations.ts";

/**
 * Библиотека готовых анимаций (вкладка «Пресеты» → «Библиотека»).
 * Всё делается эффектом Transform (+ Gaussian Blur для размытия) — без сторонних плагинов.
 */

export const LIB_CATEGORIES = ["Вход", "Выход", "Акцент", "Вход + выход"] as const;
export type LibCategory = (typeof LIB_CATEGORIES)[number];

type Def = Partial<AnimPreset> & Pick<AnimPreset, "id" | "name" | "kind"> & { category: LibCategory };

const L = (d: Def): AnimPreset => ({
  dx: 0,
  dy: 0,
  scale: 100,
  rotation: 0,
  fade: false,
  glyph: "•",
  easing: "bezier",
  blur: true,
  distance: 100,
  duration: 0.4,
  builtin: true,
  ...d,
  id: `lib-${d.id}`,
});

export const LIBRARY: AnimPreset[] = [
  // Вход
  L({ id: "slide-in-l", name: "Влёт слева", category: "Вход", kind: "in", dx: -1, glyph: "→", duration: 0.35, curve: [0.16, 1, 0.3, 1] }),
  L({ id: "slide-in-r", name: "Влёт справа", category: "Вход", kind: "in", dx: 1, glyph: "←", duration: 0.35, curve: [0.16, 1, 0.3, 1] }),
  L({ id: "spring-in-l", name: "Пружина слева", category: "Вход", kind: "in", dx: -1, overshoot: 12, glyph: "↪", duration: 0.5 }),
  L({ id: "drop-in", name: "Падение с отскоком", category: "Вход", kind: "in", dy: -1, overshoot: 15, glyph: "↓", duration: 0.55 }),
  L({ id: "rise-in", name: "Подъём снизу", category: "Вход", kind: "in", dy: 0.25, fade: true, glyph: "↑", duration: 0.5, curve: [0.16, 1, 0.3, 1] }),
  L({ id: "soft-in", name: "Мягкое появление", category: "Вход", kind: "in", scale: 92, fade: true, blur: false, glyph: "◐", duration: 0.5 }),
  L({ id: "blur-in", name: "Из размытия", category: "Вход", kind: "in", fade: true, blurAmt: 40, blur: false, glyph: "◌", duration: 0.5 }),
  L({ id: "pop-in", name: "Поп", category: "Вход", kind: "in", scale: 30, overshoot: 18, fade: true, glyph: "●", duration: 0.4 }),
  L({ id: "whip-in-l", name: "Свайп слева", category: "Вход", kind: "in", dx: -1, blurAmt: 60, glyph: "»", duration: 0.18, curve: [0.16, 1, 0.3, 1] }),
  L({ id: "spin-in", name: "Закрутка", category: "Вход", kind: "in", rotation: -90, scale: 50, fade: true, glyph: "↻", duration: 0.45 }),
  L({ id: "zoom-blur-in", name: "Наезд из размытия", category: "Вход", kind: "in", scale: 140, fade: true, blurAmt: 30, glyph: "⤢", duration: 0.45, curve: [0.16, 1, 0.3, 1] }),

  // Выход
  L({ id: "slide-out-r", name: "Улёт вправо", category: "Выход", kind: "out", dx: 1, glyph: "→", duration: 0.35, curve: [0.7, 0, 0.84, 0] }),
  L({ id: "slide-out-l", name: "Улёт влево", category: "Выход", kind: "out", dx: -1, glyph: "←", duration: 0.35, curve: [0.7, 0, 0.84, 0] }),
  L({ id: "anticip-out-r", name: "Замах и улёт", category: "Выход", kind: "out", dx: 1, overshoot: 10, glyph: "↩", duration: 0.5 }),
  L({ id: "fall-out", name: "Падение вниз", category: "Выход", kind: "out", dy: 1, glyph: "↓", duration: 0.4, curve: [0.7, 0, 0.84, 0] }),
  L({ id: "soft-out", name: "Мягкое исчезновение", category: "Выход", kind: "out", scale: 92, fade: true, blur: false, glyph: "◑", duration: 0.5 }),
  L({ id: "blur-out", name: "В размытие", category: "Выход", kind: "out", fade: true, blurAmt: 40, blur: false, glyph: "◌", duration: 0.5 }),
  L({ id: "collapse-out", name: "Схлопывание", category: "Выход", kind: "out", scale: 20, fade: true, overshoot: 8, glyph: "•", duration: 0.4 }),
  L({ id: "whip-out-r", name: "Свайп вправо", category: "Выход", kind: "out", dx: 1, blurAmt: 60, glyph: "»", duration: 0.18, curve: [0.7, 0, 0.84, 0] }),
  L({ id: "spin-out", name: "Улёт с поворотом", category: "Выход", kind: "out", rotation: 90, scale: 50, fade: true, glyph: "↻", duration: 0.45 }),

  // Акцент
  L({ id: "punch", name: "Удар (punch-in)", category: "Акцент", kind: "in", scale: 118, blur: false, glyph: "✷", duration: 0.25 }),
  L({ id: "shake", name: "Тряска", category: "Акцент", kind: "in", shake: 2.5, blur: true, glyph: "≋", duration: 0.45, easing: "linear" }),
  L({ id: "shake-hard", name: "Сильная тряска", category: "Акцент", kind: "in", shake: 6, blur: true, glyph: "≋", duration: 0.6, easing: "linear" }),
  L({ id: "slow-push", name: "Медленный наезд", category: "Акцент", kind: "whole", scale: 110, blur: false, glyph: "⤢" }),
  L({ id: "slow-pull", name: "Медленный отъезд", category: "Акцент", kind: "whole", scale: 90, blur: false, glyph: "⤡" }),
  L({ id: "drift-r", name: "Дрейф вправо", category: "Акцент", kind: "whole", dx: 0.05, scale: 108, blur: false, glyph: "→" }),

  // Вход + выход
  L({ id: "fade-both", name: "Растворение", category: "Вход + выход", kind: "both", fade: true, blur: false, glyph: "◐", duration: 0.4 }),
  L({ id: "soft-both", name: "Мягко", category: "Вход + выход", kind: "both", scale: 94, fade: true, blur: false, glyph: "◍", duration: 0.45 }),
  L({ id: "pass-lr", name: "Проезд слева направо", category: "Вход + выход", kind: "both", dx: -1, through: true, glyph: "⇢", duration: 0.35 }),
  L({ id: "pop-both", name: "Поп", category: "Вход + выход", kind: "both", scale: 30, overshoot: 15, fade: true, glyph: "●", duration: 0.4 }),
  L({ id: "blur-both", name: "Через размытие", category: "Вход + выход", kind: "both", fade: true, blurAmt: 40, blur: false, glyph: "◌", duration: 0.45 }),
];

const FAV_KEY = "animFavorites";

export function loadFavorites(get: (k: string) => string | null): string[] {
  try {
    const v = JSON.parse(get(FAV_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveFavorites(set: (k: string, v: string) => void, ids: string[]): void {
  set(FAV_KEY, JSON.stringify(ids));
}
