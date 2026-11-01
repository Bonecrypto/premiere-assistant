import { clearMarkers } from "../automation/markers.ts";
import type { HostTool } from "./types.ts";

const tool: HostTool<Record<string, never>> = {
  spec: {
    name: "premiere.clear_markers",
    description: "Удаляет все маркеры активной секвенции. Один Ctrl+Z.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    runsIn: "host",
    mutates: true,
    confirmText: "Удалить ВСЕ маркеры активной секвенции. Отменяется одним Ctrl+Z.",
  },
  run: () => clearMarkers(),
};

export default tool;
