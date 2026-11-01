/**
 * Цветовые метки Premiere (Label). Названия ключей — как в Premiere UXP API
 * (Constants.ProjectItemColorLabel); числовое значение берём из API во время работы.
 * Цвета образцов — примерные цвета меток Premiere по умолчанию (у пользователя могут быть свои).
 */
/** Порядок меток в Premiere (16 штук). Номер метки в проекте = позиция в этом списке. */
export const LABEL_KEYS = [
  "VIOLET", "IRIS", "CARIBBEAN", "LAVENDER", "CERULEAN", "FOREST", "ROSE", "MANGO", "PURPLE",
  "BLUE", "TEAL", "MAGENTA", "TAN", "GREEN", "BROWN", "YELLOW",
] as const;

export type LabelKey = (typeof LABEL_KEYS)[number];

export const LABELS: Record<LabelKey, { name: string; swatch: string }> = {
  VIOLET: { name: "Violet", swatch: "#a990dd" },
  IRIS: { name: "Iris", swatch: "#5a6fe8" },
  CARIBBEAN: { name: "Caribbean", swatch: "#1db58f" },
  LAVENDER: { name: "Lavender", swatch: "#e384e3" },
  CERULEAN: { name: "Cerulean", swatch: "#2d9ee0" },
  FOREST: { name: "Forest", swatch: "#4e8a3e" },
  ROSE: { name: "Rose", swatch: "#f0476b" },
  MANGO: { name: "Mango", swatch: "#f2a33a" },
  PURPLE: { name: "Purple", swatch: "#9b3fd0" },
  BLUE: { name: "Blue", swatch: "#3b62d6" },
  TEAL: { name: "Teal", swatch: "#1f9c9c" },
  MAGENTA: { name: "Magenta", swatch: "#d6278e" },
  TAN: { name: "Tan", swatch: "#c8a46e" },
  GREEN: { name: "Green", swatch: "#3fa34d" },
  BROWN: { name: "Brown", swatch: "#8a5a2b" },
  YELLOW: { name: "Yellow", swatch: "#e8d44d" },
};

export function isLabelKey(v: unknown): v is LabelKey {
  return typeof v === "string" && (LABEL_KEYS as readonly string[]).includes(v);
}
