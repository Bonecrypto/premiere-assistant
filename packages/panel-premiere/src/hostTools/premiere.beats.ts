import { beatHits, beatMarkers, findBeats, pickBeats } from "../automation/beats.ts";
import { HITS } from "../automation/hits.ts";
import { HostToolError, type HostTool } from "./types.ts";

interface Input {
  action: "find" | "markers" | "hits";
  every?: number;
  hit?: string;
}

let lastGrid: Awaited<ReturnType<typeof findBeats>> | null = null;

/** Монтаж под бит. */
const tool: HostTool<Input> = {
  spec: {
    name: "premiere.beats",
    description:
      "Монтаж под бит. find — найти биты в ВЫДЕЛЕННОМ клипе с музыкой (темп и количество); markers — маркеры на найденные биты " +
      "(потом premiere.montage place_on_markers раскладывает клипы под бит); hits — «удар» (hit: " +
      HITS.map((h) => h.id).join(", ") +
      ") на каждом бите у ВЫДЕЛЕННЫХ видеоклипов. every — каждый 1-й/2-й/4-й бит. Сначала всегда find (пользователь выделяет музыку), " +
      "потом попроси выделить видео для hits.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["find", "markers", "hits"] },
        every: { type: "number", enum: [1, 2, 4] },
        hit: { type: "string", enum: HITS.map((h) => h.id) },
      },
      required: ["action"],
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Найти биты / поставить маркеры / удары на биты (см. «Параметры»). Отмена — Ctrl+Z.",
  },
  async run(input) {
    if (input.action === "find") {
      lastGrid = await findBeats();
      return { bpm: lastGrid.bpm, beats: lastGrid.times.length, clip: lastGrid.clip };
    }
    if (!lastGrid) throw new HostToolError("Сначала найдите биты (action: find) на выделенной музыке.");
    const times = pickBeats(lastGrid, input.every ?? 1);
    return input.action === "markers" ? beatMarkers(times) : beatHits(input.hit ?? "hit-punch", times);
  },
};

export default tool;
