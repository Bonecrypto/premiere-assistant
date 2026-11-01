import { classify } from "../automation/classify.ts";
import { loadRules } from "../automation/rules.ts";
import { readTimeline } from "../automation/timeline.ts";
import type { HostTool } from "./types.ts";

const MAX_CLIPS = 300;

/** Клипы активной секвенции с типом (музыка, SFX, голос…) и текущим цветом. Только чтение. */
const tool: HostTool<Record<string, never>> = {
  spec: {
    name: "premiere.read_timeline",
    description:
      "Читает активную секвенцию Premiere: дорожки и клипы (имя, дорожка, начало и длительность в секундах, путь к файлу, " +
      "текущий цвет метки) и для каждого клипа — к какой категории его относят правила покраски (музыка, звуковые эффекты, " +
      "голос, звук с камеры, видео, графика, корректирующий слой) и почему. Используй, чтобы понять монтаж, найти клипы " +
      "или проверить, как будет покрашен таймлайн. Только чтение.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    runsIn: "host",
    mutates: false,
  },
  async run() {
    const data = await readTimeline();
    const rules = loadRules();
    const clips = data.clips.slice(0, MAX_CLIPS).map((c) => {
      const cl = classify(c, rules);
      return {
        track: `${c.kind === "video" ? "V" : "A"}${c.trackIndex + 1}${c.trackName ? ` (${c.trackName})` : ""}`,
        name: c.clipName,
        start: Math.round(c.startSeconds * 100) / 100,
        duration: Math.round(c.durationSeconds * 100) / 100,
        file: c.mediaPath || null,
        label: c.currentLabel,
        category: cl.category,
        why: cl.reason,
      };
    });
    return {
      project: data.projectName,
      sequence: data.sequenceName,
      totalClips: data.clips.length,
      ...(data.clips.length > MAX_CLIPS ? { note: `Показаны первые ${MAX_CLIPS} клипов из ${data.clips.length}.` } : {}),
      clips,
    };
  },
};

export default tool;
