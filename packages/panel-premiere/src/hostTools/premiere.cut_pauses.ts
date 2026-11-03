import { cutPauses, findPauses } from "../automation/silence.ts";
import type { HostTool } from "./types.ts";

interface Input {
  noise?: number;
  min?: number;
  pad?: number;
  dryRun?: boolean;
}

/** Вырезать паузы в выделенном клипе с речью. */
const tool: HostTool<Input> = {
  spec: {
    name: "premiere.cut_pauses",
    description:
      "Найти и вырезать паузы (тишину) в ВЫДЕЛЕННОМ клипе с речью (видео со звуком или звук): куски речи встают вплотную, " +
      "эффекты клипа сохраняются, клипы правее на тех же дорожках сдвигаются (музыка на других дорожках — нет). " +
      "noise — порог тишины в дБ (по умолчанию −38; тише запись — ставь −45), min — минимальная пауза в секундах (0.5), " +
      "pad — запас вокруг речи (0.1). dryRun: true — только посчитать паузы, ничего не резать.",
    inputSchema: {
      type: "object",
      properties: {
        noise: { type: "number", minimum: -70, maximum: -10 },
        min: { type: "number", minimum: 0.1, maximum: 5 },
        pad: { type: "number", minimum: 0, maximum: 0.5 },
        dryRun: { type: "boolean" },
      },
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Вырезать паузы в выделенном клипе (клипы правее на тех же дорожках сдвинутся). Отмена — несколько Ctrl+Z.",
  },
  async run(input) {
    const plan = await findPauses({ noise: input.noise ?? -38, min: input.min ?? 0.5, pad: input.pad ?? 0.1 });
    if (input.dryRun || !plan.pauses) return { pauses: plan.pauses, removedSeconds: Math.round(plan.removed * 10) / 10 };
    return cutPauses(plan);
  },
};

export default tool;
