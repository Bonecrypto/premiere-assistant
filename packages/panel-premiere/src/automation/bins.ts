import { HostToolError } from "../hostTools/types.ts";
import { classify } from "./classify.ts";
import type { ColorRules } from "./rules.ts";
import { ppro } from "./timeline.ts";

/**
 * «Разложить проект по папкам»: файлы из корня проекта (то, что ещё не разложено) переносятся
 * в папки по типу. Уже разложенное по папкам не трогаем. FolderItem.createBinAction + createMoveItemAction.
 */

export const BIN_NAMES = {
  video: "Видео",
  music: "Музыка",
  sfx: "SFX",
  voice: "Голос",
  camera_audio: "Видео",
  graphics: "Графика",
  text: "Титры",
  adjustment: "Графика",
  sequence: "Секвенции",
  other: "Прочее",
} as const;

export interface BinPlan {
  moves: Array<{ item: any; name: string; bin: string }>;
  byBin: Array<{ bin: string; count: number }>;
}

async function mediaSeconds(clip: any): Promise<number> {
  try {
    const media = await clip.getMedia();
    if (!media) return 0;
    if (typeof media.getDuration === "function") return media.getDuration()?.seconds ?? 0;
    const d = await media.duration;
    return d?.seconds ?? 0;
  } catch {
    return 0;
  }
}

const AUDIO_EXT = /\.(wav|mp3|aif|aiff|m4a|aac|flac|ogg|wma|opus)$/i;

export async function planBins(rules: ColorRules): Promise<{ project: any; root: any; plan: BinPlan }> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const root = await project.getRootItem();
  const items: any[] = (await root.getItems()) ?? [];

  const moves: BinPlan["moves"] = [];
  for (const item of items) {
    if (p.FolderItem.cast(item)) continue; // папки не трогаем
    const clip = p.ClipProjectItem.cast(item);
    const name: string = item.name ?? "";
    let bin: string = BIN_NAMES.other;
    if (clip) {
      if (await clip.isSequence().catch(() => false)) bin = BIN_NAMES.sequence;
      else {
        const path: string = (await clip.getMediaFilePath().catch(() => "")) || "";
        const isAudio = AUDIO_EXT.test(path);
        const cat = classify(
          {
            kind: isAudio ? "audio" : "video",
            trackName: "",
            clipName: name,
            mediaPath: path,
            durationSeconds: isAudio ? await mediaSeconds(clip) : 0,
            isAdjustment: /adjustment|корректир/i.test(name),
          },
          rules,
        ).category;
        bin = BIN_NAMES[cat];
      }
    }
    moves.push({ item, name, bin });
  }
  const counts = new Map<string, number>();
  for (const m of moves) counts.set(m.bin, (counts.get(m.bin) ?? 0) + 1);
  return { project, root, plan: { moves, byBin: [...counts.entries()].map(([bin, count]) => ({ bin, count })) } };
}

function run(project: any, title: string, fill: (c: any) => void): void {
  let ok = false;
  let error: unknown = null;
  project.lockedAccess(() => {
    try {
      ok = project.executeTransaction(fill, title);
    } catch (err) {
      error = err;
    }
  });
  if (error) throw new HostToolError(`Premiere не дал выполнить «${title}»: ${(error as Error)?.message ?? error}`);
  if (!ok) throw new HostToolError(`Premiere отклонил «${title}».`);
}

export async function applyBins(rules: ColorRules): Promise<{ moved: number; bins: string[] }> {
  const p = ppro() as any;
  const { project, root, plan } = await planBins(rules);
  if (plan.moves.length === 0) return { moved: 0, bins: [] };
  const needed = [...new Set(plan.moves.map((m) => m.bin))];

  const findBins = async () => {
    const map = new Map<string, any>();
    for (const it of (await root.getItems()) ?? []) {
      const f = p.FolderItem.cast(it);
      if (f && needed.includes(it.name)) map.set(it.name, f);
    }
    return map;
  };

  let bins = await findBins();
  const missing = needed.filter((b) => !bins.has(b));
  if (missing.length) {
    run(project, "Ассистент: папки проекта", (c) => {
      for (const b of missing) c.addAction(root.createBinAction(b, false));
    });
    bins = await findBins();
  }

  run(project, "Ассистент: разложить по папкам", (c) => {
    for (const m of plan.moves) {
      const folder = bins.get(m.bin);
      if (folder) c.addAction(root.createMoveItemAction(m.item, folder));
    }
  });
  return { moved: plan.moves.filter((m) => bins.has(m.bin)).length, bins: needed };
}
