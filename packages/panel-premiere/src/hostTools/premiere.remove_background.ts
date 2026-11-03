import { removeBackgroundSelected } from "../automation/removeBg.ts";
import type { HostTool } from "./types.ts";

/** Удалить фон с выделенной картинки (нейросеть локально, программа в трее). */
const tool: HostTool<Record<string, never>> = {
  spec: {
    name: "premiere.remove_background",
    description:
      "Убрать фон с ВЫДЕЛЕННОГО на таймлайне клипа — картинки (PNG/JPG) или видео (MP4/MOV/MKV…, обрабатывается только кусок на таймлайне, результат ProRes 4444 с прозрачностью): нейросеть на компьютере пользователя вырезает человека/объект, " +
      "результат (PNG с прозрачностью) кладётся на дорожку над исходником — между ними можно поставить текст («текст за человеком»). " +
      "Видео обрабатывается на видеокарте (DirectML) или, если её нет, на процессоре — тогда долго. В первый раз нужно скачать нейросеть (~210 МБ, для видео ещё ffmpeg ~90 МБ) — панель попросит нажать ещё раз.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    runsIn: "host",
    mutates: true,
    confirmText: "Убрать фон с выделенного клипа и положить результат над ним (новый PNG/MOV в папке плагина + импорт в проект).",
  },
  run() {
    return removeBackgroundSelected();
  },
};

export default tool;
