import { getPremiere } from "../env.ts";
import { HostToolError, type HostTool } from "./types.ts";

/**
 * Базовый контекст: открытый проект и активная секвенция. Только чтение.
 * Используемые методы есть в Premiere DOM API 25.6+: Project.getActiveProject, project.name/path,
 * project.getActiveSequence, sequence.name, getVideoTrackCount, getAudioTrackCount, getEndTime.
 */
const tool: HostTool<Record<string, never>> = {
  spec: {
    name: "premiere.get_context",
    description:
      "Возвращает базовые сведения об открытом в Premiere Pro проекте: имя и путь проекта, " +
      "активную секвенцию (имя, количество видео- и аудиодорожек, длительность). " +
      "Используй, когда нужно понять, с каким проектом/секвенцией работает пользователь.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    runsIn: "host",
    mutates: false,
  },
  async run() {
    const ppro = getPremiere();
    if (!ppro) throw new HostToolError("Premiere API недоступен: панель запущена вне Premiere Pro.");

    const project = await ppro.Project.getActiveProject();
    if (!project) return { project: null, note: "В Premiere нет открытого проекта." };

    const sequence = await project.getActiveSequence();
    if (!sequence) {
      return { project: { name: project.name, path: project.path }, activeSequence: null };
    }
    const [videoTracks, audioTracks, end] = await Promise.all([
      sequence.getVideoTrackCount(),
      sequence.getAudioTrackCount(),
      sequence.getEndTime(),
    ]);
    return {
      project: { name: project.name, path: project.path },
      activeSequence: {
        name: sequence.name,
        videoTracks,
        audioTracks,
        durationSeconds: Math.round(end.seconds * 100) / 100,
      },
    };
  },
};

export default tool;
