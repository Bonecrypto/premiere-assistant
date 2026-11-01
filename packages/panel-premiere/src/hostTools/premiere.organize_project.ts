import { applyBins } from "../automation/bins.ts";
import { loadRules } from "../automation/rules.ts";
import type { HostTool } from "./types.ts";

const tool: HostTool<Record<string, never>> = {
  spec: {
    name: "premiere.organize_project",
    description:
      "Раскладывает файлы из КОРНЯ проекта по папкам: Видео, Музыка, SFX, Голос, Графика, Секвенции, Прочее (по правилам " +
      "распознавания, как в покраске). Файлы, уже лежащие в папках, и сами папки не трогает. Отмена — Ctrl+Z (2 раза).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    runsIn: "host",
    mutates: true,
    confirmText: "Разложить файлы из корня проекта по папкам Видео / Музыка / SFX / Голос / Графика / Секвенции. Ваши папки не трогаются.",
  },
  run: () => applyBins(loadRules()),
};

export default tool;
