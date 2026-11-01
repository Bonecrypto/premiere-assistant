import { BUILTIN_ANIMS, loadAnimOptions, loadUserAnims } from "../presets/animations.ts";
import type { HostTool } from "./types.ts";

/** Список анимаций-пресетов (встроенные + свои) и общие настройки. */
const tool: HostTool<Record<string, never>> = {
  spec: {
    name: "premiere.list_animations",
    description: "Возвращает анимации-пресеты (встроенные и свои пользовательские) с параметрами и общие настройки (длительность, моушн-блюр).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    runsIn: "host",
    mutates: false,
  },
  async run() {
    return { options: loadAnimOptions(), builtin: BUILTIN_ANIMS, user: loadUserAnims() };
  },
};

export default tool;
