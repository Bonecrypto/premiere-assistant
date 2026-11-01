import { applyFxPreset, captureFxPreset, loadFxPresets } from "../automation/fxPresets.ts";
import { HostToolError, type HostTool } from "./types.ts";

/** «Мои пресеты эффектов» для чата: сохранить с клипа, применить, список — в одном инструменте. */
const tool: HostTool<{ action: "list" | "save" | "apply"; name?: string; includeBuiltIn?: boolean }> = {
  spec: {
    name: "premiere.effects_presets",
    description:
      "Пресеты эффектов пользователя. action list — список сохранённых (имя, видео/звук, эффекты). " +
      "action save — сохранить эффекты ПЕРВОГО выделенного клипа под именем name (includeBuiltIn — вместе с Motion/Opacity). " +
      "action apply — применить пресет name к выделенным клипам того же типа (добавит эффекты и перенесёт настройки).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "save", "apply"] },
        name: { type: "string" },
        includeBuiltIn: { type: "boolean" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Пресеты эффектов: сохранить с выделенного клипа или применить к выделенным (что именно — в «Параметрах»).",
  },
  async run(input) {
    if (input.action === "list") {
      return loadFxPresets().map((p) => ({ name: p.name, kind: p.kind, effects: p.components.map((c) => c.displayName) }));
    }
    if (input.action === "save") {
      const p = await captureFxPreset(input.name ?? "", Boolean(input.includeBuiltIn));
      return { saved: p.name, effects: p.components.map((c) => c.displayName) };
    }
    const name = (input.name ?? "").trim().toLowerCase();
    const preset = loadFxPresets().find((p) => p.name.toLowerCase() === name) ?? loadFxPresets().find((p) => p.name.toLowerCase().includes(name));
    if (!preset) throw new HostToolError(`Нет пресета «${input.name}». Сохранённые: ${loadFxPresets().map((p) => p.name).join(", ") || "нет"}.`);
    return applyFxPreset(preset);
  },
};

export default tool;
