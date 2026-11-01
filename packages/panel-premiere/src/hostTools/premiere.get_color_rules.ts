import { LABEL_KEYS } from "../automation/labels.ts";
import { loadRules } from "../automation/rules.ts";
import type { HostTool } from "./types.ts";

/** Текущие правила покраски таймлайна. Только чтение. */
const tool: HostTool<Record<string, never>> = {
  spec: {
    name: "premiere.get_color_rules",
    description:
      "Возвращает правила покраски таймлайна: для каждой категории (music, sfx, voice, camera_audio, video, graphics, " +
      "adjustment) — цвет метки, слова-подсказки и включена ли; ручные уточнения (overrides: «если имя/путь содержит X — " +
      "это категория Y»); порог длительности музыки. Доступные цвета: " + LABEL_KEYS.join(", ") + ".",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    runsIn: "host",
    mutates: false,
  },
  async run() {
    return loadRules();
  },
};

export default tool;
