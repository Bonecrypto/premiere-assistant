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

/** Номер метки из API → ключ («ROSE»). Значения берём из Constants, а не угадываем. */
export function labelKeyFromIndex(index: number): LabelKey | null {
  const consts = (ppro().Constants as unknown as { ProjectItemColorLabel: Record<string, number> }).ProjectItemColorLabel;
  return LABEL_KEYS.find((k) => consts[k] === index) ?? null;
}

export function labelIndexFromKey(key: LabelKey): number {
  const consts = (ppro().Constants as unknown as { ProjectItemColorLabel: Record<string, number> }).ProjectItemColorLabel;
  const v = consts[key];
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
