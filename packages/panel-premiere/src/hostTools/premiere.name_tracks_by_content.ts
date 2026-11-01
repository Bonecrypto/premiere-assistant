import { loadRules } from "../automation/rules.ts";
import { planTrackNames, renameTracks } from "../automation/tracks.ts";
import type { HostTool } from "./types.ts";

/** Подписать дорожки по тому, что на них лежит. */
const tool: HostTool<{ only?: "audio" | "video" | "all" }> = {
  spec: {
    name: "premiere.name_tracks_by_content",
    description:
      "Сам называет дорожки по содержимому: на каждой дорожке смотрит, каких клипов больше, и даёт имя — «Голос», " +
      "«Музыка», «SFX», «Звук с камеры», «Видео», «Графика» (повторы нумерует: «Музыка 2»). Пустые дорожки не трогает. " +
      "only: audio — только звуковые, video — только видео, all — все (по умолчанию). Один Ctrl+Z.",
    inputSchema: {
      type: "object",
      properties: { only: { type: "string", enum: ["audio", "video", "all"] } },
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Подписать дорожки по содержимому: «Голос», «Музыка», «SFX», «Видео», «Графика»… Отменяется одним Ctrl+Z.",
  },
  async run(input) {
    const plan = await planTrackNames(loadRules(), input.only ?? "all");
    const changes = plan.filter((p) => p.name !== p.oldName);
    const renamed = await renameTracks(changes);
    return {
      renamed,
      tracks: plan.map((p) => `${p.kind === "video" ? "V" : "A"}${p.number}: «${p.oldName}» → «${p.name}»`),
    };
  },
};

export default tool;
