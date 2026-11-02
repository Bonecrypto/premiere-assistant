import { adjustmentLayer, blackVideo, colorMatte } from "../automation/quickCreate.ts";
import { HostToolError, type HostTool } from "./types.ts";

interface Input {
  kind: "black_video" | "color_matte" | "adjustment_layer";
  color?: string;
}

/** «Создать»: Black Video / Color Matte / Adjustment Layer под плейхед (или на длину выделенных клипов). */
const tool: HostTool<Input> = {
  spec: {
    name: "premiere.quick_create",
    description:
      "Положить на таймлайн под плейхед (а если выделены клипы — на их длину) на свободную видеодорожку над V1: " +
      "black_video — чёрный кадр; color_matte — однотонная плашка цвета color (#RRGGBB); adjustment_layer — корректирующий слой " +
      "(берётся уже существующий в проекте: создать новый API не даёт — тогда попроси пользователя один раз File → New → Adjustment Layer).",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["black_video", "color_matte", "adjustment_layer"] },
        color: { type: "string", description: "#RRGGBB для color_matte" },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Добавить элемент на таймлайн (и, если нужно, однотонную картинку в проект). Отмена — Ctrl+Z.",
  },
  async run(input) {
    switch (input.kind) {
      case "black_video":
        return blackVideo();
      case "color_matte": {
        const c = (input.color ?? "").trim();
        if (!/^#?[0-9a-f]{6}$/i.test(c)) throw new HostToolError("Укажи color в виде #RRGGBB.");
        return colorMatte(c);
      }
      case "adjustment_layer":
        return adjustmentLayer();
    }
  },
};

export default tool;
