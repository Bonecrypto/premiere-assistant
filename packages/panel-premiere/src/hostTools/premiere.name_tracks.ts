import { applyTrackTemplate, loadTrackTemplate, saveTrackTemplate } from "../automation/trackTemplate.ts";
import type { HostTool } from "./types.ts";

const tool: HostTool<{ video?: string[]; audio?: string[] }> = {
  spec: {
    name: "premiere.name_tracks",
    description:
      "Называет дорожки активной секвенции по шаблону пользователя (по умолчанию V1–V3 Video, V4+ Graphics; A1–A3 Voice, A4–A5 Music, " +
      "остальные SFX). video/audio — свой список имён по порядку дорожек (последнее имя повторяется с номером для остальных); " +
      "если переданы — сохраняются как новый шаблон. Отмена — Ctrl+Z.",
    inputSchema: {
      type: "object",
      properties: {
        video: { type: "array", items: { type: "string" }, description: "Имена V1, V2…" },
        audio: { type: "array", items: { type: "string" }, description: "Имена A1, A2…" },
      },
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Переименовать дорожки активной секвенции по шаблону.",
  },
  run: async (input) => {
    if (input.video?.length || input.audio?.length) {
      const t = loadTrackTemplate();
      saveTrackTemplate({ video: input.video?.length ? input.video : t.video, audio: input.audio?.length ? input.audio : t.audio });
    }
    return (await applyTrackTemplate()).text;
  },
};

export default tool;
