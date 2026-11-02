import { HostToolError } from "../hostTools/types.ts";
import { ppro } from "./timeline.ts";

/**
 * «Монтаж»: действия с выделенными клипами через Premiere UXP API.
 * TrackItem.createMoveAction(Δ) — сдвиг на величину; createSetEndAction — конец клипа на таймлайне;
 * createSetDisabledAction — вкл/выкл; Markers.getMarkers(sequence) — маркеры секвенции.
 */

export interface MontageResult {
  changed: number;
  skipped: string[];
}

interface Clip {
  item: any;
  name: string;
  kind: "video" | "audio";
  track: number;
  start: number;
  end: number;
}

const T = (s: number) => (ppro() as any).TickTime.createWithSeconds(s);

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

async function describe(item: any): Promise<Clip> {
  const isVideo = typeof item.isAdjustmentLayer === "function" && typeof item.createAddVideoTransitionAction === "function";
  return {
    item,
    name: (await item.getName?.().catch(() => "")) || "клип",
    kind: isVideo ? "video" : "audio",
    track: await item.getTrackIndex(),
    start: (await item.getStartTime()).seconds,
    end: (await item.getEndTime()).seconds,
  };
}

async function selection(): Promise<{ project: any; sequence: any; clips: Clip[] }> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new HostToolError("Нет активной секвенции.");
  const sel = await sequence.getSelection();
  const items: any[] = (await sel?.getTrackItems()) ?? [];
  if (!items.length) throw new HostToolError("Выделите клипы на таймлайне.");
  const clips: Clip[] = [];
  for (const it of items) clips.push(await describe(it));
  return { project, sequence, clips };
}

/** Все клипы дорожки (для проверки, что между выделенными нет чужих). */
async function trackClips(sequence: any, kind: "video" | "audio", index: number): Promise<Clip[]> {
  const p = ppro() as any;
  const track = kind === "video" ? await sequence.getVideoTrack(index) : await sequence.getAudioTrack(index);
  const items: any[] = (await track?.getTrackItems(p.Constants?.TrackItemType?.CLIP ?? 1, false)) ?? [];
  const out: Clip[] = [];
  for (const it of items) out.push(await describe(it));
  return out;
}

function byTrack(clips: Clip[]): Map<string, Clip[]> {
  const m = new Map<string, Clip[]>();
  for (const c of clips) {
    const k = `${c.kind}:${c.track}`;
    m.set(k, [...(m.get(k) ?? []), c]);
  }
  for (const list of m.values()) list.sort((a, b) => a.start - b.start);
  return m;
}

const trackName = (k: string) => {
  const [kind, i] = k.split(":");
  return `${kind === "video" ? "V" : "A"}${Number(i) + 1}`;
};

/** Сдвинуть выделенные клипы вплотную друг к другу (на каждой дорожке отдельно, от первого выделенного). */
export async function closeGaps(): Promise<MontageResult> {
  const { project, sequence, clips } = await selection();
  const res: MontageResult = { changed: 0, skipped: [] };
  const moves: Array<{ item: any; delta: number }> = [];
  for (const [key, list] of byTrack(clips)) {
    if (list.length < 2) continue;
    const all = await trackClips(sequence, list[0].kind, list[0].track);
    const first = list[0].start;
    const last = list[list.length - 1].end;
    const selectedStarts = new Set(list.map((c) => c.start.toFixed(4)));
    const foreign = all.some((c) => c.start >= first - 0.001 && c.end <= last + 0.001 && !selectedStarts.has(c.start.toFixed(4)));
    if (foreign) {
      res.skipped.push(`${trackName(key)}: между выделенными есть другие клипы`);
      continue;
    }
    let cursor = list[0].end;
    for (const c of list.slice(1)) {
      const delta = cursor - c.start;
      if (Math.abs(delta) > 0.0005) {
        moves.push({ item: c.item, delta });
        res.changed++;
      }
      cursor += c.end - c.start;
    }
  }
  if (!moves.length) {
    if (res.skipped.length) throw new HostToolError(res.skipped[0]);
    throw new HostToolError("Пустот между выделенными клипами нет (или выделен один клип на дорожке).");
  }
  run(project, "Ассистент: убрать пустоты", (c) => {
    for (const m of moves) c.addAction(m.item.createMoveAction(T(m.delta)));
  });
  return res;
}

/** Разложить выделенные клипы по маркерам секвенции (по порядку), по желанию обрезать до следующего маркера. */
export async function placeOnMarkers(trimToNext: boolean): Promise<MontageResult> {
  const p = ppro() as any;
  const { project, sequence, clips } = await selection();
  const markersObj = await p.Markers.getMarkers(sequence);
  const markers: number[] = ((await markersObj.getMarkers()) ?? [])
    .map((m: any) => m.getStart?.()?.seconds ?? m.getStart?.seconds ?? 0)
    .filter((n: number) => Number.isFinite(n))
    .sort((a: number, b: number) => a - b);
  if (!markers.length) throw new HostToolError("В секвенции нет маркеров. Поставьте их (клавиша M) или «Авто → Маркеры».");
  const res: MontageResult = { changed: 0, skipped: [] };
  const moves: Array<{ item: any; delta: number }> = [];
  const ends: Array<{ item: any; end: number }> = [];
  for (const [key, list] of byTrack(clips)) {
    const startAt = markers.findIndex((m) => m >= list[0].start - 0.001);
    const from = startAt >= 0 ? startAt : 0;
    list.forEach((c, i) => {
      const m = markers[from + i];
      if (m === undefined) {
        res.skipped.push(`${trackName(key)}: «${c.name}» — не хватило маркеров`);
        return;
      }
      const delta = m - c.start;
      if (Math.abs(delta) > 0.0005) moves.push({ item: c.item, delta });
      const next = markers[from + i + 1];
      const newEnd = c.end + delta;
      if (trimToNext && next !== undefined && newEnd > next) ends.push({ item: c.item, end: next });
      res.changed++;
    });
  }
  if (!res.changed) throw new HostToolError(res.skipped[0] ?? "Нечего раскладывать.");
  // Сначала укоротить (чтобы клипы не налезали), затем сдвинуть: справа налево, чтобы не перекрывать соседей.
  if (ends.length) {
    run(project, "Ассистент: обрезать до маркеров", (c) => {
      for (const e of ends) {
        // Конец пока в старой позиции: новый конец минус будущий сдвиг.
        const mv = moves.find((m) => m.item === e.item)?.delta ?? 0;
        c.addAction(e.item.createSetEndAction(T(e.end - mv)));
      }
    });
  }
  if (moves.length) {
    const ordered = [...moves].sort((a, b) => b.delta - a.delta);
    run(project, "Ассистент: разложить по маркерам", (c) => {
      for (const m of ordered) c.addAction(m.item.createMoveAction(T(m.delta)));
    });
  }
  return res;
}

/** Одинаковая длительность выделенных клипов (сдвигается только конец; для фото/графики — без ограничений). */
export async function setDuration(seconds: number, pack: boolean): Promise<MontageResult> {
  const { project, clips } = await selection();
  const res: MontageResult = { changed: 0, skipped: [] };
  run(project, "Ассистент: длительность клипов", (c) => {
    for (const cl of clips) {
      c.addAction(cl.item.createSetEndAction(T(cl.start + seconds)));
      res.changed++;
    }
  });
  if (pack) {
    try {
      await closeGaps();
    } catch {
      /* пустот нет — нормально */
    }
  }
  return res;
}

/** Выключить/включить выделенные клипы (как Shift+E). */
export async function toggleEnabled(): Promise<MontageResult> {
  const { project, clips } = await selection();
  const states: boolean[] = [];
  for (const c of clips) states.push(Boolean(await c.item.isDisabled?.()));
  const allDisabled = states.every(Boolean);
  run(project, allDisabled ? "Ассистент: включить клипы" : "Ассистент: выключить клипы", (c) => {
    for (const cl of clips) c.addAction(cl.item.createSetDisabledAction(!allDisabled));
  });
  return { changed: clips.length, skipped: [] };
}
