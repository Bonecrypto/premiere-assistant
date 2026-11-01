import { applyPlan, planColoring, planSummary } from "../automation/coloring.ts";
import { CATEGORY_ORDER, loadRules, type CategoryId } from "../automation/rules.ts";
import type { HostTool } from "./types.ts";

/** Покраска таймлайна по правилам. Меняет проект — только после подтверждения пользователя. */
const tool: HostTool<{ categories?: CategoryId[] }> = {
  spec: {
    name: "premiere.color_timeline",
    description:
      "ПОКРАСКА ПРОЕКТА: красит ФАЙЛЫ в панели Project, используемые в активной секвенции, по правилам пользователя " +
      "(музыка, SFX, голос, звук с камеры, видео, графика, корректирующие слои — своим цветом метки). Клипы, УЖЕ лежащие " +
      "на таймлайне, Premiere при этом НЕ перекрашивает (API не умеет менять цвет клипа на таймлайне) — для них: " +
      "premiere.select_clips по категории + пользователь ставит Label, или вкладка «Авто → Покраска таймлайна» (пошаговый мастер). " +
      "Отменяется одним Ctrl+Z. Можно ограничить категориями. " +
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
