import { applyPlan, planColoring, planSummary } from "../automation/coloring.ts";
import { CATEGORY_ORDER, loadRules, type CategoryId } from "../automation/rules.ts";
import type { HostTool } from "./types.ts";

/** Покраска таймлайна по правилам. Меняет проект — только после подтверждения пользователя. */
const tool: HostTool<{ categories?: CategoryId[] }> = {
  spec: {
    name: "premiere.color_timeline",
    description:
      "Красит клипы активной секвенции по правилам пользователя: музыка, звуковые эффекты, голос, звук с камеры, видео, " +
      "графика, корректирующие слои — каждая категория своим цветом метки. Технически меняет цвет элементов проекта, " +
      "используемых в секвенции (так устроен Premiere UXP API); отменяется одним Ctrl+Z. Можно ограничить категориями. " +
      "Перед вызовом можно посмотреть план через premiere.read_timeline. Правила меняются через premiere.update_color_rules.",
    inputSchema: {
      type: "object",
      properties: {
        categories: {
          type: "array",
          description: "Красить только эти категории (по умолчанию — все включённые).",
          items: { type: "string", enum: CATEGORY_ORDER },
        },
      },
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText:
      "Покрасить клипы активной секвенции по вашим правилам (вкладка «Авто»): музыка, звуковые эффекты, голос, видео, " +
      "графика — каждая своим цветом. Меняется цвет элементов проекта; отменяется одним Ctrl+Z.",
  },
  async run(input) {
    const planned = await planColoring(loadRules(), input.categories);
    const changed = await applyPlan(planned);
    return { changed, summary: planSummary(planned.plan), skippedWithoutProjectItem: planned.plan.skipped };
  },
};

export default tool;
