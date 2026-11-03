import { makeSubtitles } from "../automation/subtitles.ts";
import type { HostTool } from "./types.ts";

interface Input {
  lang?: string;
  maxChars?: number;
  caps?: boolean;
}

/** Автосубтитры выделенного клипа. */
const tool: HostTool<Input> = {
  spec: {
    name: "premiere.subtitles",
    description:
      "Сделать субтитры для ВЫДЕЛЕННОГО клипа с речью: распознавание на компьютере пользователя (whisper.cpp), " +
      "файл .srt импортируется в проект и кладётся на таймлайн с начала клипа (если Premiere не даст — пользователь перетаскивает сам). " +
      "lang — auto | ru | uk | en; maxChars — длина строки (по умолчанию 32); caps — заглавными. В первый раз нужна загрузка ~580 МБ — панель попросит нажать ещё раз.",
    inputSchema: {
      type: "object",
      properties: {
        lang: { type: "string", enum: ["auto", "ru", "uk", "en"] },
        maxChars: { type: "number", minimum: 12, maximum: 60 },
        caps: { type: "boolean" },
      },
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Распознать речь выделенного клипа и добавить субтитры (файл .srt в папке плагина + импорт в проект).",
  },
  run(input) {
    return makeSubtitles({ lang: input.lang ?? "auto", maxChars: input.maxChars ?? 32, caps: input.caps });
  },
};

export default tool;
