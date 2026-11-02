import { changeLevel, duckMusic, fades } from "../automation/sound.ts";
import { HostToolError, type HostTool } from "./types.ts";

interface Input {
  action: "gain" | "level" | "fades" | "duck_music";
  db?: number;
  fade_in?: number;
  fade_out?: number;
  fade?: number;
}

/** «Звук»: громкость через Volume → Level. */
const tool: HostTool<Input> = {
  spec: {
    name: "premiere.sound",
    description:
      "Звук: gain — изменить громкость ВЫДЕЛЕННЫХ аудиоклипов на db дБ (±); level — выставить уровень db дБ; " +
      "fades — фейды выделенных (fade_in, fade_out, секунды); duck_music — приглушить ВСЮ музыку секвенции под голосом на db дБ " +
      "(например −12, fade — плавность, с); голос и музыка определяются по правилам покраски/ролям дорожек. Измерять LUFS не умеет.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["gain", "level", "fades", "duck_music"] },
        db: { type: "number" },
        fade_in: { type: "number", minimum: 0 },
        fade_out: { type: "number", minimum: 0 },
        fade: { type: "number", minimum: 0 },
      },
      required: ["action"],
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Изменить громкость (ключи/уровень Volume). Отмена — Ctrl+Z.",
  },
  async run(input) {
    switch (input.action) {
      case "gain":
        if (typeof input.db !== "number") throw new HostToolError("Укажи db.");
        return changeLevel({ delta: input.db });
      case "level":
        if (typeof input.db !== "number") throw new HostToolError("Укажи db.");
        return changeLevel({ absolute: input.db });
      case "fades":
        return fades(input.fade_in ?? 0.5, input.fade_out ?? 1);
      case "duck_music":
        return duckMusic(input.db ?? -12, input.fade ?? 0.3);
    }
  },
};

export default tool;
