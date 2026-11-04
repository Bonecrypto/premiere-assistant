import type { EffectStep, FxRecipe, ParamSet } from "../automation/fxRecipes.ts";

/**
 * Готовые «пачки» стандартных эффектов Premiere. Названия эффектов и параметров — английские и русские
 * (как в интерфейсе Premiere); чего нет в версии пользователя — пропускается с пояснением.
 */

const P = (names: string[], value: number | boolean | string, neutral?: number, index?: number): ParamSet => ({ names, value, neutral, index });

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
/** Transform с моушн-блюром: Use Composition's Shutter Angle = выкл, Shutter Angle = 360. */
export const transformBlur: EffectStep = {
  label: "Transform",
  match: ["AE.ADBE Geometry2"],
  names: ["Transform", "Преобразовать", "Трансформирование", "Преобразование"],
  params: [
    P(["Use Composition's Shutter Angle", "Use Composition’s Shutter Angle", "Использовать угол затвора композиции"], false, undefined, 9),
    P(["Shutter Angle", "Угол затвора"], 360, undefined, 10),
  ],
};
/**
 * Скругление углов: Roughen Edges с «Фрактальным влиянием» = 0 — края не рвутся, углы просто скругляются.
 * Радиус — «Граница» (Border), мягкость края — «Резкость края» (Edge Sharpness).
 */
const roundCorners = (border: number, sharpness: number): EffectStep => ({
  label: "Roughen Edges",
  match: ["AE.ADBE Roughen Edges"],
  names: ["Roughen Edges", "Шероховатые края", "Грубые края", "Огрубление краев"],
  params: [
    P(["Border", "Граница", "Рамка"], border),
    P(["Edge Sharpness", "Резкость края", "Резкость краев"], sharpness),
    P(["Fractal Influence", "Фрактальное влияние", "Влияние фрактала"], 0),
  ],
});
/** Свечение по яркости: VR Glow (есть во всех версиях Premiere, работает и с обычным видео). */
const vrGlow = (radius: number): EffectStep => ({
  label: "VR Glow",
  names: ["VR Glow", "VR-свечение", "Свечение VR", "Свечение (VR)"],
  params: [P(["Glow Radius", "Радиус свечения"], radius)],
});
/** Свечение по краю альфа-канала: PNG, текст, логотипы. */
const alphaGlow = (size: number, brightness: number): EffectStep => ({
  label: "Alpha Glow",
  names: ["Alpha Glow", "Альфа-свечение", "Свечение альфа-канала", "Свечение альфа"],
  params: [P(["Glow", "Свечение"], size, undefined, 0), P(["Brightness", "Яркость"], brightness, undefined, 1)],
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

/** Виньетка Lumetri: сила (минус — темнее, плюс — светлее), средняя точка (меньше — шире), растушёвка. */
const vignetteFx = (amount: number, midpoint = 50, feather = 50, roundness = 0): EffectStep => ({
  label: "Lumetri Color",
  match: ["AE.ADBE Lumetri"],
  names: ["Lumetri Color", "Цвет Lumetri", "Lumetri"],
  params: [
    P(["Amount", "Величина", "Количество"], amount, 0),
    P(["Midpoint", "Средняя точка", "Середина"], midpoint, 50),
    P(["Roundness", "Округлость", "Скругление"], roundness, 0),
    P(["Feather", "Растушевка", "Растушёвка"], feather, 50),
  ],
});

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
  R("round-s", "Скругление S", "Углы", "Слегка скруглить углы картинки/PNG", [roundCorners(12, 2)]),
  R("round-m", "Скругление M", "Углы", "Заметно скруглённые углы", [roundCorners(30, 1.5)]),
  R("round-l", "Скругление L", "Углы", "Сильное скругление, почти «таблетка»", [roundCorners(70, 1)]),
  R("vig-soft", "Мягкая", "Виньетка", "Слегка затемнить края, широкая мягкая", [vignetteFx(-1, 55, 75)]),
  R("vig-strong", "Сильная", "Виньетка", "Тёмные края, фокус на центре", [vignetteFx(-2.5, 35, 60)]),
  R("vig-tight", "Туннель", "Виньетка", "Узкое светлое пятно в центре — драма, флешбэк", [vignetteFx(-3, 15, 80, 20)]),
  R("vig-white", "Белая", "Виньетка", "Светлые края — мечта, воспоминание", [vignetteFx(2, 45, 75)]),
  R("vig-off", "Убрать", "Виньетка", "Убрать виньетку Lumetri", [vignetteFx(0)]),
  R("glow-soft", "Свечение", "Свечение", "Мягкий ореол вокруг светлых мест (VR Glow)", [vrGlow(25)]),
  R("glow-strong", "Сильное свечение", "Свечение", "Яркий ореол — огни, неон, блики", [vrGlow(60)]),
  R("glow-alpha", "Свечение контура", "Свечение", "Свет по краю PNG, текста, логотипа (Alpha Glow)", [alphaGlow(15, 200)]),
  R("glow-neon", "Неон-контур", "Свечение", "Широкий яркий контур вокруг PNG/текста", [alphaGlow(40, 255)]),
  R("transform-mb", "Transform + блюр 360", "Движение", "Transform с моушн-блюром: Shutter 360°, без «Use Composition's»", [transformBlur]),
];

/** Вкладка «Эффекты» — движение (готовые анимации из библиотеки «Пресетов»). */
export const FX_MOTION: Array<{ id: string; name: string; desc: string; anim: string }> = [
  { id: "wobble", name: "Camera wobble", desc: "Лёгкое плавное покачивание на весь клип", anim: "lib-wobble" },
  { id: "shake", name: "Шейк", desc: "Тряска камеры на старте клипа", anim: "lib-shake" },
  { id: "shake-hard", name: "Сильный шейк", desc: "Удар, взрыв, бас", anim: "lib-shake-hard" },
  { id: "punch", name: "Удар (punch-in)", desc: "Резкий наезд и возврат", anim: "lib-punch" },
  { id: "pop", name: "Поп", desc: "Появление с пружиной", anim: "lib-pop-in" },
  { id: "push", name: "Медленный наезд", desc: "Плавно на весь клип", anim: "lib-slow-push" },
];

/** Tint (Окраска): тёмное → цвет black, светлое → цвет white; сила — Amount to Tint (0…100). */
const tint = (black: string, white: string, amount = 100): EffectStep => ({
  label: "Tint",
  match: ["AE.ADBE Tint"],
  names: ["Tint", "Окраска", "Тонирование", "Оттенок"],
  params: [
    P(["Map Black To", "Преобразовать черный в", "Сопоставить черный с", "Черный в"], black, undefined, 0),
    P(["Map White To", "Преобразовать белый в", "Сопоставить белый с", "Белый в"], white, undefined, 1),
    P(["Amount to Tint", "Степень окраски", "Величина окраски", "Степень тонирования"], amount, 0, 2),
  ],
});

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
  R("tint-mono", "Монохром", "Тинт", "Ч/Б через Tint — тёмное в чёрный, светлое в белый", [tint("#000000", "#ffffff")]),
  R("tint-sepia", "Сепия", "Тинт", "Старое фото: коричневые тени, кремовые света", [tint("#2b1a0a", "#f3dfb0")]),
  R("tint-blue", "Синий", "Тинт", "Холодный дуотон: тёмно-синие тени, голубые света", [tint("#0b1a4a", "#9fdcff")]),
  R("tint-vice", "Vice", "Тинт", "Фиолетовые тени, розовые света — в стиле GTA Vice City", [tint("#2b0a4a", "#ff6fb5")]),
  R("tint-sunset", "Закат", "Тинт", "Фиолетовые тени, оранжевые света", [tint("#3a0a3a", "#ffb35c")]),
  R("tint-green", "Матрица", "Тинт", "Тёмно-зелёные тени, салатовые света", [tint("#001a0a", "#7dff9a")]),
  R("tint-red", "Красный", "Тинт", "Тревога, флешбэк: красный дуотон", [tint("#1a0000", "#ff5a4a")]),
  R("tint-half", "Лёгкий тинт", "Тинт", "Тёплый дуотон на 40% — цвет остаётся", [tint("#2a1030", "#ffd8a0", 40)]),
  R("tint-off", "Убрать тинт", "Тинт", "Amount to Tint = 0", [tint("#000000", "#ffffff", 0)]),
  R("reset", "Сбросить", "Детали", "Вернуть Lumetri к нейтральным значениям", [
    lumetri({ temperature: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 100, vibrance: 0, faded: 0, vignette: 0 }),
  ]),
];
