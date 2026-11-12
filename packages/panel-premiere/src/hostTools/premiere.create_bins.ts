import { createProjectBins, loadBinTemplate } from "../automation/projectBins.ts";
import type { HostTool } from "./types.ts";

const tool: HostTool<{ folders?: string[] }> = {
  spec: {
    name: "premiere.create_bins",
    description:
      "Создаёт в проекте структуру папок (бинов) по шаблону пользователя — по умолчанию на английском: 01 Footage (Video, Photo), " +
      "02 Audio (Music, SFX, Voice), 03 Graphics (Titles, PNG), 04 Sequences, 05 Archive. Уже существующие папки не дублирует. " +
      "folders — свой список путей («Папка» или «Папка/Подпапка»), если пользователь назвал другие. Отмена — Ctrl+Z.",
    inputSchema: {
      type: "object",
      properties: { folders: { type: "array", items: { type: "string" }, description: "Пути папок; пусто — шаблон пользователя" } },
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Создать в проекте папки по шаблону (существующие не трогаются).",
  },
  run: (input) => createProjectBins(input.folders?.length ? input.folders : loadBinTemplate()),
};

export default tool;
