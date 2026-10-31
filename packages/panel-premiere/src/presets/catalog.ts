/**
 * Каталог пресетов для Effect Controls. Пока только описание и интерфейс:
 * применение появится вместе с host-инструментом (этап 3) после проверки,
 * что Premiere UXP API умеет менять параметры Motion (Position/Scale/Anchor Point).
 */

export type AlignAnchor =
  | "top-left" | "top" | "top-right"
  | "left" | "center" | "right"
  | "bottom-left" | "bottom" | "bottom-right";

export const ALIGN_GRID: { id: AlignAnchor; label: string; glyph: string }[][] = [
  [
    { id: "top-left", label: "Слева сверху", glyph: "↖" },
    { id: "top", label: "Сверху по центру", glyph: "↑" },
    { id: "top-right", label: "Справа сверху", glyph: "↗" },
  ],
  [
    { id: "left", label: "Слева по центру", glyph: "←" },
    { id: "center", label: "По центру", glyph: "●" },
    { id: "right", label: "Справа по центру", glyph: "→" },
  ],
  [
    { id: "bottom-left", label: "Слева снизу", glyph: "↙" },
    { id: "bottom", label: "Снизу по центру", glyph: "↓" },
    { id: "bottom-right", label: "Справа снизу", glyph: "↘" },
  ],
];

/** Отступ от края кадра: по краю, «безопасная зона действия» 5%, «безопасная зона титров» 10%. */
export type SafeMargin = "edge" | "action" | "title";

export const SAFE_MARGINS: { id: SafeMargin; label: string; hint: string }[] = [
  { id: "edge", label: "Край", hint: "вплотную к краю кадра" },
  { id: "action", label: "5%", hint: "безопасная зона действия" },
  { id: "title", label: "10%", hint: "безопасная зона титров" },
];

export interface UserPreset {
  id: string;
  name: string;
  /** Что сохранено: например, «Motion: Position, Scale». */
  summary: string;
  createdAt: number;
}
