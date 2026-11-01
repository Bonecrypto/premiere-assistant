import { addMarkers, type MarkerMode } from "../automation/markers.ts";
import type { HostTool } from "./types.ts";

const tool: HostTool<{ mode: MarkerMode; interval?: number; name?: string }> = {
  spec: {
    name: "premiere.add_markers",
    description:
      "Ставит маркеры в активной секвенции: mode cuts — на каждой склейке (начала клипов на видеодорожках), interval — " +
      "каждые interval секунд (name — подпись, например «Глава»). Один Ctrl+Z.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["cuts", "interval"] },
        interval: { type: "number", minimum: 1 },
        name: { type: "string" },
      },
      required: ["mode"],
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Поставить маркеры в секвенции (как — в «Параметрах»). Отменяется одним Ctrl+Z.",
  },
  run: (i) => addMarkers(i.mode, i.interval ?? 10, i.name ?? "Маркер"),
};

export default tool;
