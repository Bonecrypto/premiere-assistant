import { analyzeCameras, applyCameras } from "../automation/cameras.ts";
import type { HostTool } from "./types.ts";

/** Переключение камер подкаста по микрофонам. */
const tool: HostTool<{ minShot?: number; dryRun?: boolean }> = {
  spec: {
    name: "premiere.cameras",
    description:
      "Подкаст/интервью: переключить камеры по тому, кто говорит. Пользователь выделяет синхронные клипы камер (V1, V2…) и микрофонов (A1, A2…): " +
      "микрофоны по порядку дорожек ↔ камеры по порядку; если камер на одну больше — самая нижняя становится общим планом (при перебивании). " +
      "Камеры режутся в точках переключения, лишние куски выключаются (не удаляются). minShot — минимальная длина плана, с (по умолчанию 2). dryRun — только посчитать.",
    inputSchema: { type: "object", properties: { minShot: { type: "number", minimum: 0.5, maximum: 10 }, dryRun: { type: "boolean" } }, additionalProperties: false },
    runsIn: "host",
    mutates: true,
    confirmText: "Разрезать выделенные камеры в точках переключения и выключить неактивные куски (ничего не удаляется). Отмена — Ctrl+Z.",
  },
  async run(input) {
    const plan = await analyzeCameras(input.minShot ?? 2);
    if (input.dryRun) return { shots: plan.shots.length, mapping: plan.mapping };
    return applyCameras(plan);
  },
};

export default tool;
