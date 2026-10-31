import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDef } from "@pa/core";
import { config } from "../config.ts";

interface Input {
  title: string;
  text: string;
}

const INBOX = () => path.join(config.knowledgeDir, "inbox");

/** Имя файла, безопасное для Windows; кириллица сохраняется. */
function slugify(title: string): string {
  const s = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return s || "заметка";
}

/** Сохраняет заметку в базу знаний (новый файл; существующие не перезаписываются). */
const tool: ToolDef<Input> = {
  name: "knowledge.save_note",
  description:
    "Сохраняет заметку в базу знаний пользователя (папка knowledge/inbox, Markdown). " +
    "Используй, когда пользователь просит запомнить, записать или сохранить рецепт, настройку, пресет или вывод. " +
    "Создаёт новый файл, существующие файлы не меняет.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Короткий заголовок заметки" },
      text: { type: "string", description: "Текст заметки в Markdown" },
    },
    required: ["title", "text"],
    additionalProperties: false,
  },
  runsIn: "helper",
  mutates: true,
  describe: (input) => {
    const preview = input.text.length > 300 ? input.text.slice(0, 300) + "…" : input.text;
    return `Создать файл в knowledge/inbox:\n«${input.title}»\n\n${preview}`;
  },
  async run(input) {
    const dir = INBOX();
    await fs.mkdir(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const base = `${date}_${slugify(input.title)}`;
    let file = path.join(dir, `${base}.md`);
    for (let i = 2; ; i++) {
      try {
        // flag "wx" — ошибка, если файл уже есть: ничего не перезаписываем.
        await fs.writeFile(file, `# ${input.title}\n\n${input.text.trim()}\n`, { encoding: "utf8", flag: "wx" });
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST" || i > 100) throw err;
        file = path.join(dir, `${base}-${i}.md`);
      }
    }
    return { saved: true, file: path.relative(config.knowledgeDir, file) };
  },
};

export default tool;
