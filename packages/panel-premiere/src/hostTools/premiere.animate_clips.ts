import { animateSelected } from "../automation/animate.ts";
import { LIBRARY } from "../presets/library.ts";
import { BUILTIN_ANIMS, findAnim, loadAnimOptions, type AnimKind, type AnimPreset } from "../presets/animations.ts";
import { HostToolError, type HostTool } from "./types.ts";

interface Input {
  preset?: string;
  custom?: {
    kind: AnimKind;
    dx?: number;
    dy?: number;
    scale?: number;
    rotation?: number;
    fade?: boolean;
    overshoot?: number;
    blurAmt?: number;
    shake?: number;
    through?: boolean;
  };
  duration?: number;
  blur?: boolean;
  distance?: number;
}

/** Анимировать выделенные клипы пресетом (Transform + ключевые кадры + моушн-блюр). */
const tool: HostTool<Input> = {
  spec: {
    name: "premiere.animate_clips",
    description:
      "Анимирует ВЫДЕЛЕННЫЕ видеоклипы эффектом Transform (с моушн-блюром Shutter Angle 360 и плавностью Bezier). " +
      "preset — готовый пресет: " +
      BUILTIN_ANIMS.map((a) => `${a.id} (${a.name})`).join(", ") +
      "; библиотека: " +
      LIBRARY.map((a) => `${a.id} (${a.name}, ${a.category})`).join(", ") +
      ", а также свои пресеты пользователя (их id — в premiere.list_animations). " +
      "Или custom: kind in (влёт в начале клипа) / out (улёт в конце) / whole (весь клип) / both (вход в начале и выход в конце), dx/dy — сдвиг в долях кадра " +
      "(-1 влево/вверх, 1 вправо/вниз), scale — масштаб в крайней точке %, rotation — градусы, fade — растворение, " +
      "overshoot — «пружина» % пути (10–20), blurAmt — размытие Gaussian Blur 0–100, shake — тряска % кадра (2–6), " +
      "through — для both: выход в противоположную сторону. " +
      "duration — секунды, blur — моушн-блюр, distance — % кадра для сдвига. Если ничего не выделено — попроси выделить.",
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string" },
        custom: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["in", "out", "whole", "both"] },
            dx: { type: "number" },
            dy: { type: "number" },
            scale: { type: "number" },
            rotation: { type: "number" },
            fade: { type: "boolean" },
            overshoot: { type: "number", minimum: 0, maximum: 60 },
            blurAmt: { type: "number", minimum: 0, maximum: 200 },
            shake: { type: "number", minimum: 0, maximum: 20 },
            through: { type: "boolean" },
          },
          required: ["kind"],
        },
        duration: { type: "number", minimum: 0.04 },
        blur: { type: "boolean" },
        distance: { type: "number", minimum: 1 },
      },
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Анимировать выделенные клипы (какой пресет — в «Параметрах»): эффект Transform с ключевыми кадрами. Отмена — Ctrl+Z.",
  },
  async run(input) {
    let preset: AnimPreset | undefined = input.preset ? findAnim(input.preset) : undefined;
    if (input.preset && !preset) throw new HostToolError(`Нет пресета «${input.preset}».`);
    if (!preset && input.custom) {
      const c = input.custom;
      preset = { id: "custom", name: "Анимация", kind: c.kind, dx: c.dx ?? 0, dy: c.dy ?? 0, scale: c.scale ?? 100, rotation: c.rotation ?? 0, fade: Boolean(c.fade), overshoot: c.overshoot, blurAmt: c.blurAmt, shake: c.shake, through: c.through, glyph: "•" };
    }
    if (!preset) throw new HostToolError("Укажи preset или custom.");
    const base = loadAnimOptions();
    const opt = {
      ...base,
      ...(input.duration ? { duration: input.duration } : {}),
      ...(typeof input.blur === "boolean" ? { blur: input.blur } : {}),
      ...(input.distance ? { distance: input.distance } : {}),
    };
    return animateSelected(preset, opt);
  },
};

export default tool;
