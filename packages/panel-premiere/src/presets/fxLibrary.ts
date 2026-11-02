import type { EffectStep, FxRecipe, ParamSet } from "../automation/fxRecipes.ts";

/**
 * Готовые «пачки» стандартных эффектов Premiere. Названия эффектов и параметров — английские и русские
 * (как в интерфейсе Premiere); чего нет в версии пользователя — пропускается с пояснением.
 */

const P = (names: string[], value: number | boolean, neutral?: number, index?: number): ParamSet => ({ names, value, neutral, index });

const blur = (amount: number): EffectStep => ({
  label: "Gaussian Blur",
  match: ["AE.ADBE Gaussian Blur 2"],
  names: ["Gaussian Blur", "Размытие по Гауссу"],
  params: [P(["Blurriness", "Размытость", "Степень размытия"], amount, 0, 0), P(["Repeat Edge Pixels", "Повторять краевые пиксели"], true, undefined, 2)],
});
const bw: EffectStep = { label: "Black & White", names: ["Black & White", "Черно-белое", "Черно-белый"], params: [] };
const brightContrast = (contrast: number, brightness = 0): EffectStep => ({
  label: "Brightness & Contrast",
  names: ["Brightness & Contrast", "Яркость и контрастность", "Яркость и контраст"],
  params: [P(["Brightness", "Яркость"], brightness, 0, 0), P(["Contrast", "Контрастность", "Контраст"], contrast, 0, 1)],
});
const noise = (amount: number): EffectStep => ({
  label: "Noise",
  names: ["Noise", "Шум"],
  params: [P(["Amount of Noise", "Количество шума", "Степень шума"], amount, 0, 0)],
});
const sharpen = (amount: number): EffectStep => ({
  label: "Sharpen",
  names: ["Sharpen", "Резкость", "Повышение резкости"],
  params: [P(["Sharpen Amount", "Степень резкости", "Величина резкости"], amount, 0, 0)],
});
const mosaic = (h: number, v: number): EffectStep => ({
  label: "Mosaic",
  names: ["Mosaic", "Мозаика"],
  params: [P(["Horizontal Blocks", "Блоки по горизонтали"], h, undefined, 0), P(["Vertical Blocks", "Блоки по вертикали"], v, undefined, 1)],
});
const posterizeTime = (fps: number): EffectStep => ({
  label: "Posterize Time",
  names: ["Posterize Time", "Постеризация времени"],
  params: [P(["Frame Rate", "Частота кадров"], fps, undefined, 0)],
});
const invert: EffectStep = { label: "Invert", names: ["Invert", "Инвертировать", "Инверсия"], params: [] };

/** Lumetri Color: только нужные параметры (нейтральные значения — для ползунка «Сила»). */
interface Lum {
  temperature?: number;
  tint?: number;
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  saturation?: number;
  vibrance?: number;
  faded?: number;
  vignette?: number;
}
export const lumetri = (l: Lum): EffectStep => {
  const params: ParamSet[] = [];
  if (l.temperature !== undefined) params.push(P(["Temperature", "Температура"], l.temperature, 0));
  if (l.tint !== undefined) params.push(P(["Tint", "Оттенок"], l.tint, 0));
  if (l.exposure !== undefined) params.push(P(["Exposure", "Экспозиция"], l.exposure, 0));
  if (l.contrast !== undefined) params.push(P(["Contrast", "Контраст", "Контрастность"], l.contrast, 0));
  if (l.highlights !== undefined) params.push(P(["Highlights", "Света"], l.highlights, 0));
  if (l.shadows !== undefined) params.push(P(["Shadows", "Тени"], l.shadows, 0));
  if (l.saturation !== undefined) params.push(P(["Saturation", "Насыщенность"], l.saturation, 100));
  if (l.vibrance !== undefined) params.push(P(["Vibrance", "Красочность", "Сочность"], l.vibrance, 0));
  if (l.faded !== undefined) params.push(P(["Faded Film", "Блеклая пленка", "Выцветшая пленка"], l.faded, 0));
  if (l.vignette !== undefined) params.push(P(["Amount", "Величина", "Количество"], l.vignette, 0));
  return { label: "Lumetri Color", match: ["AE.ADBE Lumetri"], names: ["Lumetri Color", "Цвет Lumetri", "Lumetri"], params };
};

const R = (id: string, name: string, group: string, desc: string, steps: EffectStep[]): FxRecipe => ({ id, name, group, desc, steps });

/** Вкладка «Эффекты». */
export const FX_RECIPES: FxRecipe[] = [
  R("soft-bg", "Размытый фон", "Стиль", "Мягкое размытие — для фона под текстом", [blur(25)]),
  R("dream", "Мечтательно", "Стиль", "Лёгкое размытие, светлее и сочнее", [blur(6), lumetri({ exposure: 0.4, faded: 20, saturation: 115 })]),
  R("bw-contrast", "Ч/Б контраст", "Стиль", "Чёрно-белое с плотным контрастом", [bw, brightContrast(30)]),
  R("vhs", "VHS", "Стиль", "Шум, выцветшие цвета, меньше насыщенности", [noise(12), lumetri({ saturation: 75, faded: 30, contrast: -10 })]),
  R("film", "Плёнка", "Стиль", "Тёплая плёнка с виньеткой и зерном", [lumetri({ faded: 35, temperature: 12, contrast: 15, vignette: -1.2 }), noise(4)]),
  R("sharpen", "Резкость", "Картинка", "Чётче детали", [sharpen(30)]),
  R("pixel", "Пиксели", "Картинка", "Мозаика — для цензуры или стиля", [mosaic(40, 24)]),
  R("stop-motion", "Stop-motion", "Картинка", "Рывками, 12 кадров/с", [posterizeTime(12)]),
  R("invert", "Инверсия", "Картинка", "Негатив", [invert]),
];

/** Вкладка «Эффекты» — движение (готовые анимации из библиотеки «Пресетов»). */
export const FX_MOTION: Array<{ id: string; name: string; desc: string; anim: string }> = [
  { id: "shake", name: "Шейк", desc: "Тряска камеры на старте клипа", anim: "lib-shake" },
  { id: "shake-hard", name: "Сильный шейк", desc: "Удар, взрыв, бас", anim: "lib-shake-hard" },
  { id: "punch", name: "Удар (punch-in)", desc: "Резкий наезд и возврат", anim: "lib-punch" },
  { id: "pop", name: "Поп", desc: "Появление с пружиной", anim: "lib-pop-in" },
  { id: "push", name: "Медленный наезд", desc: "Плавно на весь клип", anim: "lib-slow-push" },
];

/** Вкладка «Цвет» — Lumetri. */
export const COLOR_RECIPES: FxRecipe[] = [
  R("warm", "Тёплый", "Тон", "Теплее и чуть сочнее", [lumetri({ temperature: 25, tint: 5, vibrance: 10 })]),
  R("cold", "Холодный", "Тон", "Холоднее, спокойнее", [lumetri({ temperature: -25, tint: -5 })]),
  R("sunset", "Закат", "Тон", "Тёплый, розоватый, светлее", [lumetri({ temperature: 35, tint: 15, exposure: 0.2, saturation: 110 })]),
  R("night", "Ночь", "Тон", "Темнее и холоднее", [lumetri({ temperature: -30, exposure: -0.8, saturation: 80 })]),
  R("cinema", "Кино", "Стиль", "Контраст, мягкие света, виньетка", [lumetri({ contrast: 20, highlights: -15, shadows: 10, saturation: 90, faded: 15, vignette: -1 })]),
  R("vivid", "Ярко", "Стиль", "Сочно для соцсетей", [lumetri({ vibrance: 30, saturation: 120, contrast: 10 })]),
  R("faded", "Выцветший", "Стиль", "Мягкий матовый вид", [lumetri({ faded: 45, contrast: -15, saturation: 85 })]),
  R("bw", "Ч/Б", "Стиль", "Чёрно-белое через Lumetri", [lumetri({ saturation: 0, contrast: 25 })]),
  R("vignette", "Виньетка", "Детали", "Затемнить края", [lumetri({ vignette: -2 })]),
  R("reset", "Сбросить", "Детали", "Вернуть Lumetri к нейтральным значениям", [
    lumetri({ temperature: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 100, vibrance: 0, faded: 0, vignette: 0 }),
  ]),
];
