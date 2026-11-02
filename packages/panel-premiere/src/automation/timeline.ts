import type { ProjectItem } from "@adobe/premierepro";
import { getPremiere } from "../env.ts";
import { HostToolError } from "../hostTools/types.ts";
import type { ClipInfo } from "./classify.ts";
import { LABEL_KEYS, type LabelKey } from "./labels.ts";

/**
 * Чтение активной секвенции через Premiere UXP API (только чтение).
 * Используемые методы есть в документации 25.6+: Sequence.getVideoTrackCount/getVideoTrack,
 * getAudioTrackCount/getAudioTrack, track.name, track.getTrackItems(CLIP), trackItem.getName/
 * getStartTime/getDuration/getProjectItem/isAdjustmentLayer, ClipProjectItem.cast/getMediaFilePath,
 * ProjectItem.getId/getColorLabelIndex.
 */

export interface TimelineClip extends ClipInfo {
  trackIndex: number;
  startSeconds: number;
  projectItem: ProjectItem | null;
  projectItemId: string | null;
  currentLabel: LabelKey | null;
  /** Сам клип на таймлайне (для выделения). */
  trackItem: unknown;
}

export interface TimelineData {
  projectName: string;
  sequenceName: string;
  clips: TimelineClip[];
  sequence: any;
}

export function ppro() {
  const p = getPremiere();
  if (!p) throw new HostToolError("Premiere API недоступен: панель запущена вне Premiere Pro.");
  return p;
}

/**
 * Таблица «ключ метки → номер». В Premiere 16 меток (Caribbean — третья), а в Constants.ProjectItemColorLabel
 * Caribbean может отсутствовать — тогда номера после Iris сдвинуты на один (проверено на Premiere 26.3:
 * «Cerulean» красил в Lavender, «Mango» — в Rose). Если Caribbean в API нет и номера идут подряд 0…14,
 * используем настоящий порядок Premiere; иначе — значения из API.
 */
export function labelTable(): { table: Record<string, number>; corrected: boolean } {
  const consts = (ppro().Constants as unknown as { ProjectItemColorLabel?: Record<string, number> }).ProjectItemColorLabel ?? {};
  if (typeof consts.CARIBBEAN === "number") return { table: consts, corrected: false };
  const apiKeys = LABEL_KEYS.filter((k) => k !== "CARIBBEAN");
  const sequential = apiKeys.every((k, i) => consts[k] === i);
  if (sequential || Object.keys(consts).length === 0) {
    return { table: Object.fromEntries(LABEL_KEYS.map((k, i) => [k, i])), corrected: true };
  }
  return { table: consts, corrected: false };
}

/** Номер метки → ключ («ROSE»). */
export function labelKeyFromIndex(index: number): LabelKey | null {
  const { table } = labelTable();
  return LABEL_KEYS.find((k) => table[k] === index) ?? null;
}

export function labelIndexFromKey(key: LabelKey): number {
  const v = labelTable().table[key];
  if (typeof v !== "number") throw new HostToolError(`Цвет ${key} не поддерживается этой версией Premiere.`);
  return v;
}

async function safe<T>(fn: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function readItem(
  item: any,
  kind: "video" | "audio",
  trackIndex: number,
  trackName: string,
): Promise<TimelineClip> {
  const p = ppro();
  const [name, start, duration, projectItem, isAdjustment] = await Promise.all([
    safe(() => item.getName() as Promise<string>, ""),
    safe(() => item.getStartTime() as Promise<{ seconds: number }>, { seconds: 0 }),
    safe(() => item.getDuration() as Promise<{ seconds: number }>, { seconds: 0 }),
    safe(() => item.getProjectItem() as Promise<ProjectItem>, null as unknown as ProjectItem),
    kind === "video" ? safe(() => item.isAdjustmentLayer() as Promise<boolean>, false) : Promise.resolve(false),
  ]);

  let mediaPath = "";
  let projectItemId: string | null = null;
  let currentLabel: LabelKey | null = null;
  if (projectItem) {
    projectItemId = await safe(() => projectItem.getId(), null as unknown as string);
    const idx = await safe(() => projectItem.getColorLabelIndex(), -1);
    currentLabel = idx >= 0 ? labelKeyFromIndex(idx) : null;
    const clip = await safe(() => p.ClipProjectItem.cast(projectItem), null);
    if (clip) mediaPath = await safe(() => clip.getMediaFilePath(), "");
  }

  return {
    kind,
    trackIndex,
    trackName,
    clipName: name,
    mediaPath: mediaPath || "",
    durationSeconds: duration?.seconds ?? 0,
    startSeconds: start?.seconds ?? 0,
    isAdjustment: Boolean(isAdjustment),
    projectItem: projectItem ?? null,
    projectItemId,
    currentLabel,
    trackItem: item,
    trackKey: `${kind === "video" ? "V" : "A"}${trackIndex + 1}`,
  };
}

export async function readTimeline(): Promise<TimelineData> {
  const p = ppro();
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new HostToolError("Нет активной секвенции. Откройте секвенцию на таймлайне.");

  const CLIP = p.Constants.TrackItemType.CLIP;
  const clips: TimelineClip[] = [];

  const [vCount, aCount] = await Promise.all([sequence.getVideoTrackCount(), sequence.getAudioTrackCount()]);

  for (let i = 0; i < vCount; i++) {
    const track = await sequence.getVideoTrack(i);
    if (!track) continue;
    const items = (await track.getTrackItems(CLIP, false)) ?? [];
    const name = track.name || `V${i + 1}`;
    clips.push(...(await Promise.all(items.map((it: any) => readItem(it, "video", i, name)))));
  }
  for (let i = 0; i < aCount; i++) {
    const track = await sequence.getAudioTrack(i);
    if (!track) continue;
    const items = (await track.getTrackItems(CLIP, false)) ?? [];
    const name = track.name || `A${i + 1}`;
    clips.push(...(await Promise.all(items.map((it: any) => readItem(it, "audio", i, name)))));
  }

  return { projectName: project.name, sequenceName: sequence.name, clips, sequence };
}
