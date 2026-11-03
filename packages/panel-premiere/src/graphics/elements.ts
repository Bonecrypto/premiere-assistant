import { inflate } from "../mogrt/zip.ts";
import { encodePng } from "../automation/quickCreate.ts";
import { GRAPHIC_MASKS } from "./masks.ts";
import { NEON } from "./neon.ts";

/** Как элемент появляется: прорисовка линейной шторкой, по кругу (радиальная), «поп» или плавно. */
export type Reveal = "wipe" | "radial" | "pop";
export type Dir = "right" | "down" | "left" | "up";

export interface GraphicDef {
  id: string;
  name: string;
  group: "Стрелки" | "Линии" | "Выделение" | "Значки" | "Плашки";
  /** Чем лучше всего появляться. */
  reveal: Reveal;
  /** Можно поворачивать (стрелки). */
  rotates?: boolean;
  /** Готовая цветная картинка из набора «Неон» (ключ в NEON) — цвет и направление не меняются. */
  neon?: string;
}

export const GRAPHICS: GraphicDef[] = [
  { id: "arrow-brush", name: "Кисть", group: "Стрелки", reveal: "wipe", rotates: true },
  { id: "arrow-flat", name: "Плоская", group: "Стрелки", reveal: "wipe", rotates: true },
  { id: "arrow-thin", name: "Тонкая", group: "Стрелки", reveal: "wipe", rotates: true },
  { id: "arrow-curve", name: "Дугой", group: "Стрелки", reveal: "wipe", rotates: true },
  { id: "arrow-loop", name: "С петлёй", group: "Стрелки", reveal: "wipe", rotates: true },
  { id: "underline-brush", name: "Мазок", group: "Линии", reveal: "wipe" },
  { id: "underline-double", name: "Двойная", group: "Линии", reveal: "wipe" },
  { id: "underline-wave", name: "Волна", group: "Линии", reveal: "wipe" },
  { id: "highlighter", name: "Маркер", group: "Линии", reveal: "wipe" },
  { id: "strike", name: "Зачеркнуть", group: "Линии", reveal: "wipe" },
  { id: "circle-hand", name: "Обвести", group: "Выделение", reveal: "radial" },
  { id: "box-round", name: "Рамка", group: "Выделение", reveal: "pop" },
  { id: "brackets", name: "Фокус", group: "Выделение", reveal: "pop" },
  { id: "cross", name: "Крестик", group: "Выделение", reveal: "pop" },
  { id: "check", name: "Галочка", group: "Выделение", reveal: "wipe" },
  { id: "sparkle", name: "Искра", group: "Значки", reveal: "pop" },
  { id: "burst", name: "Акцент", group: "Значки", reveal: "pop" },
  { id: "cursor", name: "Курсор", group: "Значки", reveal: "pop" },
  { id: "dot", name: "Точка", group: "Значки", reveal: "pop" },
  { id: "exclaim", name: "Внимание", group: "Значки", reveal: "pop" },
  { id: "plate", name: "Плашка", group: "Плашки", reveal: "wipe" },
  { id: "plate-pill", name: "Таблетка", group: "Плашки", reveal: "wipe" },
  { id: "plate-brush", name: "Мазок-фон", group: "Плашки", reveal: "wipe" },
  { id: "plate-line", name: "Линия", group: "Плашки", reveal: "wipe" },
  // Набор «Неон» (Vice City-стиль, design/neon): готовые цветные PNG.
  { id: "neon-swoosh", name: "Взмах", group: "Стрелки", reveal: "wipe", neon: "01" },
  { id: "neon-swoosh-cyan", name: "Взмах голубой", group: "Стрелки", reveal: "wipe", neon: "02" },
  { id: "neon-curve", name: "Дугой", group: "Стрелки", reveal: "wipe", neon: "03" },
  { id: "neon-down", name: "Вниз", group: "Стрелки", reveal: "pop", neon: "04" },
  { id: "neon-loop", name: "С петлёй", group: "Стрелки", reveal: "wipe", neon: "05" },
  { id: "neon-arrow", name: "Стрелка", group: "Стрелки", reveal: "wipe", neon: "06" },
  { id: "neon-chevrons", name: "Шевроны", group: "Стрелки", reveal: "wipe", neon: "07" },
  { id: "neon-return", name: "Возврат", group: "Стрелки", reveal: "radial", neon: "08" },
  { id: "neon-underline-duo", name: "Двойная", group: "Линии", reveal: "wipe", neon: "09" },
  { id: "neon-underline", name: "Мазок", group: "Линии", reveal: "wipe", neon: "10" },
  { id: "neon-scribble", name: "Каракули", group: "Линии", reveal: "wipe", neon: "11" },
  { id: "neon-oval", name: "Обвести", group: "Выделение", reveal: "radial", neon: "12" },
  { id: "neon-frame", name: "Рамка", group: "Выделение", reveal: "pop", neon: "13" },
  { id: "neon-corners", name: "Фокус", group: "Выделение", reveal: "pop", neon: "14" },
  { id: "neon-cross", name: "Крестик", group: "Выделение", reveal: "pop", neon: "15" },
  { id: "neon-check", name: "Галочка", group: "Выделение", reveal: "wipe", neon: "16" },
  { id: "neon-sparkles", name: "Искры", group: "Значки", reveal: "pop", neon: "17" },
  { id: "neon-pointer", name: "Курсор", group: "Значки", reveal: "pop", neon: "18" },
  { id: "neon-pin", name: "Метка", group: "Значки", reveal: "pop", neon: "19" },
  { id: "neon-palm", name: "Закат", group: "Значки", reveal: "pop", neon: "20" },
];

export const GRAPHIC_COLORS: Array<{ hex: string; name: string }> = [
  { hex: "#ffffff", name: "Белый" },
  { hex: "#000000", name: "Чёрный" },
  { hex: "#ff3b30", name: "Красный" },
  { hex: "#ffd60a", name: "Жёлтый" },
  { hex: "#9f18ec", name: "Фиолетовый" },
  { hex: "#34c759", name: "Зелёный" },
  { hex: "#0a84ff", name: "Синий" },
];

export function thumbOf(id: string): string | undefined {
  const n = GRAPHICS.find((g) => g.id === id)?.neon;
  if (n) return NEON[n]?.thumb;
  return GRAPHIC_MASKS[id]?.thumb;
}

/** Маска прозрачности, повёрнутая под направление (исходно элементы смотрят вправо). */
function mask(id: string, dir: Dir): { w: number; h: number; a: Uint8Array } {
  const m = GRAPHIC_MASKS[id];
  if (!m) throw new Error(`Нет элемента «${id}».`);
  const bin = atobBytes(m.z);
  const a = inflate(bin, m.w * m.h).subarray(0, m.w * m.h);
  if (dir === "right") return { w: m.w, h: m.h, a };
  const W = m.w;
  const H = m.h;
  if (dir === "left") {
    const o = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) o[y * W + x] = a[(H - 1 - y) * W + (W - 1 - x)];
    return { w: W, h: H, a: o };
  }
  // down: поворот на 90° по часовой; up: против часовой. Новый размер H×W.
  const o = new Uint8Array(W * H);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < H; x++) o[y * H + x] = dir === "down" ? a[(H - 1 - x) * W + y] : a[x * W + (W - 1 - y)];
  return { w: H, h: W, a: o };
}

/** PNG элемента: цвет hex, направление. */
export function graphicPng(id: string, hex: string, dir: Dir): Uint8Array {
  const n = GRAPHICS.find((g) => g.id === id)?.neon;
  if (n) {
    if (!NEON[n]) throw new Error(`Нет элемента «${id}».`);
    return atobBytes(NEON[n].png);
  }
  const { w, h, a } = mask(id, dir);
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) ?? ["", "ff", "ff", "ff"];
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = r;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = b;
    px[i * 4 + 3] = a[i];
  }
  return encodePng(w, h, px, 4);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** base64 → байты (без atob: в UXP его может не быть). */
function atobBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}
