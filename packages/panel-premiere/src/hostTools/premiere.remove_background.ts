import { removeBackgroundSelected } from "../automation/removeBg.ts";
import type { HostTool } from "./types.ts";

/** Удалить фон с выделенной картинки (нейросеть локально, программа в трее). */
const tool: HostTool<Record<string, never>> = {
  spec: {
    name: "premiere.remove_background",
    description:
      "Убрать фон с ВЫДЕЛЕННОЙ на таймлайне картинки (PNG/JPG): нейросеть на компьютере пользователя вырезает человека/объект, " +
      "результат (PNG с прозрачностью) кладётся на дорожку над исходником — между ними можно поставить текст («текст за человеком»). " +
      "Видео пока не поддерживается. В первый раз нужно скачать нейросеть (~250 МБ) — панель попросит нажать ещё раз.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    runsIn: "host",
    mutates: true,
    confirmText: "Убрать фон с выделенной картинки и положить результат над ней (новый PNG в папке плагина + импорт в проект).",
  },
  run() {
    return removeBackgroundSelected();
  },
};

export default tool;
