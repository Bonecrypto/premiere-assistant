import { closeGaps, placeOnMarkers, setDuration, toggleEnabled } from "../automation/montage.ts";
import { HostToolError, type HostTool } from "./types.ts";

interface Input {
  action: "close_gaps" | "place_on_markers" | "set_duration" | "toggle_enabled";
  seconds?: number;
  trim?: boolean;
  pack?: boolean;
}

/** «Монтаж»: действия с выделенными клипами. */
const tool: HostTool<Input> = {
  spec: {
    name: "premiere.montage",
    description:
      "Действия с ВЫДЕЛЕННЫМИ клипами: close_gaps — убрать пустоты (вплотную на каждой дорожке); place_on_markers — разложить по маркерам " +
      "секвенции по порядку (trim: обрезать до следующего маркера); set_duration — одинаковая длительность seconds (pack: сразу вплотную); " +
      "toggle_enabled — выключить/включить. Разрезать под плейхедом — только кнопкой во вкладке «Монтаж» (через клавиши).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["close_gaps", "place_on_markers", "set_duration", "toggle_enabled"] },
        seconds: { type: "number", minimum: 0.04 },
        trim: { type: "boolean" },
        pack: { type: "boolean" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Изменить выделенные клипы на таймлайне (см. «Параметры»). Отмена — Ctrl+Z.",
  },
  async run(input) {
    switch (input.action) {
      case "close_gaps":
        return closeGaps();
      case "place_on_markers":
        return placeOnMarkers(input.trim ?? true);
      case "set_duration":
        if (!input.seconds) throw new HostToolError("Укажи seconds.");
        return setDuration(input.seconds, input.pack ?? true);
      case "toggle_enabled":
        return toggleEnabled();
    }
  },
};

export default tool;
