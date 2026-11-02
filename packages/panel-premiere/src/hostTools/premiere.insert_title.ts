import { findMogrt, insertMogrt, loadIndex } from "../mogrt/library.ts";
import { HostToolError, type HostTool } from "./types.ts";

interface Input {
  name?: string;
  list?: boolean;
  at_seconds?: number;
}

/** Титры пользователя (.mogrt внутри плагина): список и вставка на таймлайн. */
const tool: HostTool<Input> = {
  spec: {
    name: "premiere.insert_title",
    description:
      "Титры/шаблоны .mogrt пользователя, сохранённые в плагине (вкладка «Титры»). list: true — вернуть список (имя, раздел). " +
      "name — вставить шаблон (по имени или его части) на таймлайн: под плейхед или в at_seconds, на свободную видеодорожку над V1. " +
      "Если шаблонов нет — попроси добавить их во вкладке «Титры». Текст внутри титра меняется в Essential Graphics.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        list: { type: "boolean" },
        at_seconds: { type: "number", minimum: 0 },
      },
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Вставить титр (.mogrt) на таймлайн. Отмена — Ctrl+Z.",
  },
  async run(input) {
    if (input.list || !input.name) {
      const all = loadIndex();
      return { count: all.length, titles: all.slice(0, 200).map((m) => ({ name: m.name, category: m.category })) };
    }
    const m = findMogrt(input.name);
    if (!m) throw new HostToolError(`Не нашёл шаблон «${input.name}». Список — premiere.insert_title с list: true.`);
    const r = await insertMogrt(m, input.at_seconds);
    return { inserted: m.name, track: `V${r.track + 1}`, at_seconds: r.at };
  },
};

export default tool;
