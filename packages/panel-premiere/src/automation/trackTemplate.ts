import { HostToolError } from "../hostTools/types.ts";
import { storageGet, storageSet } from "../env.ts";
import { ppro } from "./timeline.ts";

/**
 * Имена дорожек по шаблону: A1–A3 — Voice, A4–A5 — Music, остальные — SFX; V1–V3 — Video, V4+ — Graphics.
 * Последнее имя в списке повторяется для всех следующих дорожек с номером («SFX 2», «SFX 3»…).
 * Track.createSetNameAction — одной транзакцией (один Ctrl+Z).
 */

export interface TrackTemplate {
  video: string[];
  audio: string[];
}

export const DEFAULT_TRACK_TEMPLATE: TrackTemplate = {
  video: ["Video 1", "Video 2", "Video 3", "Graphics"],
  audio: ["Voice 1", "Voice 2", "Voice 3", "Music 1", "Music 2", "SFX"],
};

const TPL_KEY = "trackTemplate";
const AUTO_KEY = "trackAutoName";
const DONE_KEY = "trackAutoDone";

export function loadTrackTemplate(): TrackTemplate {
  try {
    const v = JSON.parse(storageGet(TPL_KEY) || "null");
    if (v && Array.isArray(v.video) && Array.isArray(v.audio)) {
      const clean = (a: unknown[]) => a.map((x) => String(x).trim()).filter(Boolean);
      return { video: clean(v.video), audio: clean(v.audio) };
    }
  } catch {
    /* по умолчанию */
  }
  return { video: [...DEFAULT_TRACK_TEMPLATE.video], audio: [...DEFAULT_TRACK_TEMPLATE.audio] };
}

export function saveTrackTemplate(t: TrackTemplate): void {
  storageSet(TPL_KEY, JSON.stringify(t));
}

/** Имя дорожки №i (с 0): из списка, а после конца списка — последнее имя с номером. */
export function trackNameAt(list: string[], i: number): string | null {
  if (!list.length) return null;
  if (i < list.length) return list[i];
  const last = list[list.length - 1];
  return `${last} ${i - list.length + 2}`;
}

/** Имя, которое Premiere даёт по умолчанию («Video 1», «Audio 3», «Видео 1»…) или пустое — такие можно переименовать сами. */
const DEFAULT_NAME = /^\s*((video|audio|видео|аудио)\s*\d+)?\s*$/i;

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
  if (error) throw new HostToolError(`Premiere не дал переименовать дорожки: ${(error as Error)?.message ?? error}`);
  if (!ok) throw new HostToolError("Premiere отклонил переименование дорожек.");
}

/**
 * Назвать дорожки активной секвенции по шаблону.
 * onlyDefault — только дорожки с именами по умолчанию (для автоматического режима, чтобы не трогать ваши имена).
 */
export async function applyTrackTemplate(opts: { onlyDefault?: boolean; sequence?: any } = {}): Promise<{ renamed: number; text: string }> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const sequence = opts.sequence ?? (await project.getActiveSequence());
  if (!sequence) throw new HostToolError("Откройте секвенцию — назову её дорожки.");
  const tpl = loadTrackTemplate();
  const [vCount, aCount] = await Promise.all([sequence.getVideoTrackCount(), sequence.getAudioTrackCount()]);
  const todo: Array<{ track: any; name: string }> = [];
  const collect = async (kind: "video" | "audio", count: number) => {
    for (let i = 0; i < count; i++) {
      const track = kind === "video" ? await sequence.getVideoTrack(i) : await sequence.getAudioTrack(i);
      const name = trackNameAt(tpl[kind], i);
      if (!track || !name) continue;
      const cur = String(track.name ?? "");
      if (cur === name) continue;
      if (opts.onlyDefault && !DEFAULT_NAME.test(cur)) continue;
      todo.push({ track, name });
    }
  };
  await collect("video", vCount);
  await collect("audio", aCount);
  if (!todo.length) return { renamed: 0, text: "Дорожки уже названы по шаблону." };
  run(project, "Ассистент: имена дорожек", (c) => {
    for (const t of todo) c.addAction(t.track.createSetNameAction(t.name));
  });
  return { renamed: todo.length, text: `Названо дорожек: ${todo.length}. Отмена — Ctrl+Z.` };
}

export function isAutoTracks(): boolean {
  return storageGet(AUTO_KEY) === "1";
}
export function setAutoTracks(v: boolean): void {
  storageSet(AUTO_KEY, v ? "1" : "0");
}

/** Автоматически: каждую новую секвенцию (один раз) — назвать дорожки с именами по умолчанию. */
export async function autoNameTracks(): Promise<string | null> {
  if (!isAutoTracks()) return null;
  const p = ppro() as any;
  const project = await p.Project.getActiveProject().catch(() => null);
  const sequence = project ? await project.getActiveSequence().catch(() => null) : null;
  if (!sequence) return null;
  const id = String(sequence.guid?.toString?.() ?? sequence.guid ?? "") || `${project.path}::${sequence.name}`;
  let done: string[] = [];
  try {
    done = JSON.parse(storageGet(DONE_KEY) || "[]");
  } catch {
    done = [];
  }
  if (done.includes(id)) return null;
  const r = await applyTrackTemplate({ onlyDefault: true, sequence });
  storageSet(DONE_KEY, JSON.stringify([...done, id].slice(-500)));
  return r.renamed ? r.text : null;
}
