import { CATEGORY_ORDER, loadRules, type CategoryId } from "../automation/rules.ts";
import { selectCategory } from "../automation/select.ts";
import type { HostTool } from "./types.ts";

/** Выделить на таймлайне клипы категории. Проект не меняет — только выделение. */
const tool: HostTool<{ category: CategoryId }> = {
  spec: {
    name: "premiere.select_clips",
    description:
      "Выделяет на таймлайне все клипы категории (music, sfx, voice, camera_audio, video, graphics, adjustment) по правилам " +
      "покраски. Используй, когда клипы на таймлайне нужно перекрасить вручную (Premiere UXP API не меняет цвет клипов " +
      "на таймлайне): выдели категорию и подскажи пользователю — правый клик по выделению → Label → нужный цвет. " +
      "Также подходит, чтобы быстро выделить, например, все звуковые эффекты.",
    inputSchema: {
      type: "object",
      properties: { category: { type: "string", enum: CATEGORY_ORDER } },
      required: ["category"],
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: false,
  },
  async run(input) {
    const n = await selectCategory(input.category, loadRules());
    return n ? { selected: n } : { selected: 0, note: "Клипов этой категории в секвенции нет." };
  },
};

export default tool;
