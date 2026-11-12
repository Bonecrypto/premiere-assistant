import { createProjectBins, loadBinTemplate } from "../automation/projectBins.ts";
import type { HostTool } from "./types.ts";

const tool: HostTool<{ folders?: string[] }> = {
  spec: {
    name: "premiere.create_bins",
    description:
      "Создаёт в проекте структуру папок (бинов) по шаблону пользователя — по умолчанию «01 Материалы» (Видео, Фото), «02 Аудио» " +
      "(Музыка, SFX, Голос), «03 Графика» (Титры, PNG), «04 Секвенции», «05 Архив». Уже существующие папки не дублирует. " +
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
