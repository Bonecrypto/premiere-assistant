import type { MotionOp } from "../automation/motion.ts";
import type { AnimKind } from "./animations.ts";

/** Пункты вкладки «Пресеты»: список слева, детали справа. */

export type AnimField =
  | "when"
  | "whenWhole"
  | "whenBoth"
  | "side"
  | "distance"
  | "scale"
  | "rotation"
  | "fade"
  | "duration"
  | "easing"
  | "blur"
  | "bounce"
  | "gblur"
  | "shake";

export interface AnimParams {
  kind: AnimKind;
  dx: number;
  dy: number;
  distance: number;
  scale: number;
  rotation: number;
  fade: boolean;
  duration: number;
  easing: "bezier" | "linear";
  blur: boolean;
  /** «Пружина», % пути. */
  overshoot: number;
  /** Размытие Gaussian Blur в крайней точке. */
  blurAmt: number;
  /** Тряска, % кадра. */
  shake: number;
  /** Для «вход + выход»: выход в другую сторону. */
  through: boolean;
}

export interface AnimItem {
  type: "anim";
  id: string;
  title: string;
  subtitle: string;
  fields: AnimField[];
  defaults: AnimParams;
}

export interface FrameItem {
  type: "frame";
  id: string;
  title: string;
  subtitle: string;
  op: MotionOp;
  details: string;
}

export const ALL_FIELDS: AnimField[] = ["whenWhole", "whenBoth", "side", "distance", "scale", "rotation", "fade", "bounce", "gblur", "shake", "duration", "easing", "blur"];

const base: AnimParams = { kind: "out", dx: 1, dy: 0, distance: 100, scale: 100, rotation: 0, fade: false, duration: 0.3, easing: "bezier", blur: true, overshoot: 0, blurAmt: 0, shake: 0, through: false };

export const ANIM_ITEMS: AnimItem[] = [
  {
    type: "anim",
    id: "slide",
    title: "Сдвиг",
    subtitle: "Влёт и улёт за край кадра",
    fields: ["whenBoth", "side", "distance", "bounce", "gblur", "duration", "easing", "blur"],
    defaults: { ...base },
  },
  {
    type: "anim",
    id: "zoom",
    title: "Масштаб",
    subtitle: "Наезд, отъезд, «поп»",
    fields: ["whenWhole", "scale", "bounce", "gblur", "duration", "easing", "blur"],
    defaults: { ...base, kind: "whole", dx: 0, scale: 115, duration: 0.4 },
  },
  {
    type: "anim",
    id: "fade",
    title: "Растворение",
    subtitle: "Появление и исчезновение",
    fields: ["whenBoth", "gblur", "duration", "easing"],
    defaults: { ...base, kind: "in", dx: 0, fade: true, blur: false, duration: 0.5 },
  },
  {
    type: "anim",
    id: "spin",
    title: "Поворот",
    subtitle: "Влёт или улёт с поворотом",
    fields: ["whenBoth", "rotation", "scale", "fade", "bounce", "duration", "easing", "blur"],
    defaults: { ...base, kind: "in", dx: 0, rotation: 90, scale: 60, fade: true, duration: 0.4 },
  },
  {
    type: "anim",
    id: "custom",
    title: "Свободная",
    subtitle: "Все настройки — соберите свою",
    fields: ALL_FIELDS,
    defaults: { ...base, rotation: 0 },
  },
  {
    type: "anim",
    id: "shake",
    title: "Тряска",
    subtitle: "Удар, землетрясение",
    fields: ["whenWhole", "shake", "duration", "blur"],
    defaults: { ...base, kind: "in", dx: 0, shake: 3, duration: 0.45, easing: "linear" },
  },
];

export const FRAME_ITEMS: FrameItem[] = [
  { type: "frame", id: "align", title: "Выравнивание", subtitle: "9 позиций с отступом", op: "align", details: "Ставит выделенные клипы в выбранную точку кадра с учётом безопасной зоны." },
  { type: "frame", id: "fit", title: "Вписать", subtitle: "Клип целиком в кадре", op: "fit", details: "Масштаб, чтобы клип полностью вошёл в кадр (останутся поля)." },
  { type: "frame", id: "fill", title: "Заполнить", subtitle: "Без чёрных полей", op: "fill", details: "Масштаб, чтобы клип закрыл весь кадр (края могут обрезаться)." },
  { type: "frame", id: "center", title: "По центру", subtitle: "Позиция — центр кадра", op: "center", details: "Ставит клип точно в центр кадра, масштаб не меняется." },
  { type: "frame", id: "fliph", title: "Отразить ↔", subtitle: "Зеркально по горизонтали", op: "fliph", details: "Добавляет эффект Horizontal Flip." },
  { type: "frame", id: "flipv", title: "Отразить ↕", subtitle: "Зеркально по вертикали", op: "flipv", details: "Добавляет эффект Vertical Flip." },
  { type: "frame", id: "reset", title: "Сбросить", subtitle: "Motion по умолчанию", op: "reset", details: "Позиция — центр, масштаб 100 %, поворот 0." },
];

/** Глиф для пункта «Мои» по направлению. */
export function glyphFor(p: AnimParams): string {
  if (p.shake) return "≋";
  if (p.dx || p.dy) {
    const g: Record<string, string> = { "-1,0": "←", "1,0": "→", "0,-1": "↑", "0,1": "↓", "-1,-1": "↖", "1,-1": "↗", "-1,1": "↙", "1,1": "↘" };
    return g[`${p.dx},${p.dy}`] ?? "•";
  }
  if (p.rotation) return "↻";
  if (p.scale !== 100) return p.scale > 100 ? "⤢" : "⤡";
  return p.fade ? "◐" : "•";
}
