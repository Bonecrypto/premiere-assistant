import { applyRecipe } from "../automation/fxRecipes.ts";
import { COLOR_RECIPES, FX_RECIPES } from "../presets/fxLibrary.ts";
import { HostToolError, type HostTool } from "./types.ts";

interface Input {
  look: string;
  strength?: number;
}

/** Пачки эффектов и цветовые пресеты Lumetri (вкладки «Эффекты» и «Цвет»). */
const tool: HostTool<Input> = {
  spec: {
    name: "premiere.apply_look",
    description:
      "Применяет к ВЫДЕЛЕННЫМ видеоклипам готовый стиль из стандартных эффектов Premiere. look — один из: " +
      [...FX_RECIPES, ...COLOR_RECIPES].map((r) => `${r.id} (${r.name}: ${r.desc})`).join("; ") +
      ". strength — сила цветовых пресетов, 0.1–1.5 (по умолчанию 1). Для движения (шейк, удар) используй premiere.animate_clips.",
    inputSchema: {
      type: "object",
      properties: { look: { type: "string" }, strength: { type: "number", minimum: 0.1, maximum: 1.5 } },
      required: ["look"],
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Применить стиль к выделенным клипам (эффекты/Lumetri). Отмена — Ctrl+Z.",
  },
  async run(input) {
    const r = [...FX_RECIPES, ...COLOR_RECIPES].find((x) => x.id === input.look || x.name.toLowerCase() === input.look.toLowerCase());
    if (!r) throw new HostToolError(`Нет стиля «${input.look}».`);
    return applyRecipe(r, input.strength ?? 1);
  },
};

export default tool;
