import { HostToolError } from "../hostTools/types.ts";
import { classify } from "./classify.ts";
import type { CategoryId, ColorRules } from "./rules.ts";
import { ppro, readTimeline } from "./timeline.ts";

/**
 * Имена дорожек: переименование (Track.createSetNameAction, есть в Premiere UXP API 25.6+ —
 * так делает официальный пример Adobe) и подписи по содержимому.
 */

export type TrackKind = "video" | "audio";

export interface TrackRename {
  kind: TrackKind;
  /** Номер дорожки как в Premiere: V1, A2 → 1, 2. */
  number: number;
  name: string;
}

export interface TrackPlanItem extends TrackRename {
  oldName: string;
  clips: number;
}

const CATEGORY_TRACK_NAME: Record<CategoryId, string> = {
  music: "Музыка",
  sfx: "SFX",
  voice: "Голос",
  camera_audio: "Звук с камеры",
  video: "Видео",
  graphics: "Графика",
  adjustment: "Корректирующие",
};

async function getTrack(sequence: any, kind: TrackKind, index: number): Promise<any> {
  return kind === "video" ? sequence.getVideoTrack(index) : sequence.getAudioTrack(index);
}

/** Переименовать дорожки одной транзакцией (один Ctrl+Z). */
export async function renameTracks(list: TrackRename[]): Promise<number> {
  if (!list.length) return 0;
  const p = ppro();
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new HostToolError("Нет активной секвенции.");
  const [vCount, aCount] = await Promise.all([sequence.getVideoTrackCount(), sequence.getAudioTrackCount()]);

  const targets: Array<{ track: any; name: string }> = [];
  for (const r of list) {
    const count = r.kind === "video" ? vCount : aCount;
    if (!Number.isInteger(r.number) || r.number < 1 || r.number > count) {
      throw new HostToolError(`Нет дорожки ${r.kind === "video" ? "V" : "A"}${r.number} (всего ${count}).`);
    }
    const name = r.name.trim();
    if (!name) throw new HostToolError("Пустое имя дорожки.");
    targets.push({ track: await getTrack(sequence, r.kind, r.number - 1), name });
  }

  let ok = false;
  let error: unknown = null;
  project.lockedAccess(() => {
    try {
      ok = project.executeTransaction((compound: any) => {
        for (const t of targets) compound.addAction(t.track.createSetNameAction(t.name));
      }, "Ассистент: имена дорожек");
    } catch (err) {
      error = err;
    }
  });
  if (error) throw new HostToolError(`Premiere не дал переименовать дорожки: ${(error as Error)?.message ?? error}`);
  if (!ok) throw new HostToolError("Premiere отклонил переименование (транзакция не выполнена).");
  return targets.length;
}

/**
 * Имена дорожек по содержимому: на каждой дорожке смотрим, каких клипов больше (музыка, SFX, голос…).
 * Пустые дорожки не трогаем; одинаковые категории нумеруем: «Музыка», «Музыка 2».
 */
export async function planTrackNames(rules: ColorRules, only: TrackKind | "all" = "all"): Promise<TrackPlanItem[]> {
  const data = await readTimeline();
  const groups = new Map<string, { kind: TrackKind; index: number; oldName: string; votes: Map<CategoryId, number>; clips: number }>();
  for (const c of data.clips) {
    if (only !== "all" && c.kind !== only) continue;
    const key = `${c.kind}:${c.trackIndex}`;
    let g = groups.get(key);
    if (!g) {
      g = { kind: c.kind, index: c.trackIndex, oldName: c.trackName, votes: new Map(), clips: 0 };
      groups.set(key, g);
    }
    const cat = classify(c, rules).category;
    g.votes.set(cat, (g.votes.get(cat) ?? 0) + 1);
    g.clips++;
  }

  const ordered = [...groups.values()].sort((a, b) => (a.kind === b.kind ? a.index - b.index : a.kind === "video" ? -1 : 1));
  const used = new Map<string, number>();
  return ordered.map((g) => {
    const cat = [...g.votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const base = CATEGORY_TRACK_NAME[cat];
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return { kind: g.kind, number: g.index + 1, name: n > 1 ? `${base} ${n}` : base, oldName: g.oldName, clips: g.clips };
  });
}
