import os from "node:os";
import type { ToolDef } from "@pa/core";
import { config, HELPER_VERSION } from "../config.ts";

/** Текущие дата/время и сведения о компьютере. Только чтение. */
const tool: ToolDef<Record<string, never>> = {
  name: "system.info",
  description:
    "Возвращает текущие дату и время пользователя, часовой пояс, ОС компьютера и версию помощника. " +
    "Используй, когда нужно знать сегодняшнюю дату/время или систему пользователя.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  runsIn: "helper",
  mutates: false,
  async run() {
    const now = new Date();
    return {
      localTime: now.toLocaleString("ru-RU"),
      isoTime: now.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      helperVersion: HELPER_VERSION,
      model: config.provider === "claude" ? config.claude.model : config.gemini.model,
    };
  },
};

export default tool;
