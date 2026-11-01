import type { ToolDef } from "@pa/core";
import { uxp } from "../env.ts";

/**
 * Инструменты, которые во встроенном режиме выполняет сама панель
 * (в режиме помощника их выполняет Node — packages/helper/src/tools).
 */
const systemInfo: ToolDef<Record<string, never>> = {
  name: "system.info",
  description:
    "Возвращает текущие дату и время пользователя, часовой пояс и версию Premiere. " +
    "Используй, когда нужно знать сегодняшнюю дату/время.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  runsIn: "host",
  mutates: false,
  async run() {
    const now = new Date();
    return {
      localTime: now.toLocaleString("ru-RU"),
      isoTime: now.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      host: uxp?.host ? `${uxp.host.name} ${uxp.host.version}` : "браузер",
    };
  },
};

function slugify(title: string): string {
  const s = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return s || "заметка";
}

const saveNote: ToolDef<{ title: string; text: string }> = {
  name: "knowledge.save_note",
  description:
    "Сохраняет заметку в базу знаний пользователя (Markdown в папке данных плагина). Используй, когда пользователь " +
    "просит запомнить, записать или сохранить рецепт, настройку, пресет или вывод. Создаёт новый файл.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Короткий заголовок заметки" },
      text: { type: "string", description: "Текст заметки в Markdown" },
    },
    required: ["title", "text"],
    additionalProperties: false,
  },
  runsIn: "host",
  mutates: true,
  describe: (input) => {
    const preview = input.text.length > 300 ? input.text.slice(0, 300) + "…" : input.text;
    return `Сохранить заметку «${input.title}»:\n\n${preview}`;
  },
  async run(input) {
    const fs = (uxp as any)?.storage?.localFileSystem;
    if (!fs) throw new Error("Файлы недоступны: панель запущена вне Premiere.");
    const root = await fs.getDataFolder();
    let folder;
    try {
      folder = await root.getEntry("knowledge");
    } catch {
      folder = await root.createFolder("knowledge");
    }
    const name = `${new Date().toISOString().slice(0, 10)}_${slugify(input.title)}-${Date.now().toString(36)}.md`;
    const file = await folder.createFile(name, { overwrite: false });
    await file.write(`# ${input.title}\n\n${input.text.trim()}\n`);
    return { saved: true, file: file.nativePath ?? name };
  },
};

export const localTools: ToolDef[] = [systemInfo, saveNote];
