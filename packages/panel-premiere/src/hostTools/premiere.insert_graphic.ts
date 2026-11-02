import { GRAPHICS } from "../graphics/elements.ts";
import { insertGraphic, type Anim } from "../graphics/insert.ts";
import type { Dir } from "../graphics/elements.ts";
import type { HostTool } from "./types.ts";

interface Input {
  id: string;
  color?: string;
  dir?: Dir;
  anim?: Anim;
  seconds?: number;
}

/** Готовые графические элементы (вкладка «Элементы»). */
const tool: HostTool<Input> = {
  spec: {
    name: "premiere.insert_graphic",
    description:
      "Вставить готовый графический элемент под плейхед на свободную видеодорожку: " +
      GRAPHICS.map((g) => `${g.id} (${g.group}: ${g.name})`).join(", ") +
      ". color — #RRGGBB (по умолчанию белый), dir — направление стрелки right|down|left|up, " +
      "anim — draw (прорисовка), pop, fade, none; seconds — длина на таймлайне.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", enum: GRAPHICS.map((g) => g.id) },
        color: { type: "string" },
        dir: { type: "string", enum: ["right", "down", "left", "up"] },
        anim: { type: "string", enum: ["draw", "pop", "fade", "none"] },
        seconds: { type: "number", minimum: 0.5, maximum: 60 },
      },
      required: ["id"],
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Добавить графический элемент на таймлайн (PNG в папке плагина + импорт в проект). Отмена — Ctrl+Z.",
  },
  run(input) {
    return insertGraphic(input.id, {
      color: /^#?[0-9a-f]{6}$/i.test(input.color ?? "") ? input.color! : "#ffffff",
      dir: input.dir ?? "right",
      anim: input.anim ?? "draw",
      seconds: input.seconds ?? 3,
    });
  },
};

export default tool;
