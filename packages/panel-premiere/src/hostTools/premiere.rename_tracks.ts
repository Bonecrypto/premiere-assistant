import { renameTracks, type TrackRename } from "../automation/tracks.ts";
import type { HostTool } from "./types.ts";

/** Переименовать конкретные дорожки. */
const tool: HostTool<{ tracks: Array<{ type: "audio" | "video"; number: number; name: string }> }> = {
  spec: {
    name: "premiere.rename_tracks",
    description:
      "Переименовывает дорожки активной секвенции: type — audio (A1, A2…) или video (V1, V2…), number — номер дорожки " +
      "как в Premiere (A3 → 3), name — новое имя. Если пользователь просит назвать дорожки по смыслу, но не говорит " +
      "какие — сначала посмотри premiere.read_timeline или используй premiere.name_tracks_by_content. Один Ctrl+Z.",
    inputSchema: {
      type: "object",
      properties: {
        tracks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["audio", "video"] },
              number: { type: "integer", minimum: 1 },
              name: { type: "string" },
            },
            required: ["type", "number", "name"],
          },
        },
      },
      required: ["tracks"],
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Переименовать дорожки секвенции (какие и как — в «Параметрах»). Отменяется одним Ctrl+Z.",
  },
  async run(input) {
    const list: TrackRename[] = input.tracks.map((t) => ({ kind: t.type, number: t.number, name: t.name }));
    const renamed = await renameTracks(list);
    return { renamed };
  },
};

export default tool;
