import { classify, type Classification } from "./classify.ts";
import { LABELS, type LabelKey } from "./labels.ts";
import { CATEGORY_ORDER, categoryName, type CategoryId, type ColorRules } from "./rules.ts";
import { labelIndexFromKey, ppro, readTimeline, type TimelineClip, type TimelineData } from "./timeline.ts";
import { HostToolError } from "../hostTools/types.ts";

/**
 * Покраска таймлайна. В Premiere UXP API цвет (Label) есть у элемента проекта, а не у клипа
 * на таймлайне, поэтому красим элементы проекта, которые используются в секвенции.
 * Все изменения — одной транзакцией: отменяются одним Ctrl+Z.
 */

export interface PlannedItem {
  projectItemId: string;
  name: string;
  category: CategoryId;
  label: LabelKey;
  currentLabel: LabelKey | null;
  clips: number;
  reason: string;
  /** Клипы этого файла попали в разные категории — взяли ту, где их больше. */
  conflict: boolean;
}

export interface ColorPlan {
  sequenceName: string;
  totalClips: number;
  items: PlannedItem[];
  /** Сколько элементов реально поменяют цвет. */
  toChange: number;
  /** По категориям: для сводки в интерфейсе и для модели. */
  byCategory: Array<{ category: CategoryId; name: string; label: LabelKey; clips: number; items: number; changes: number }>;
  /** Клипы без элемента проекта — покрасить нельзя. */
  skipped: number;
}

export interface PlanWithRefs {
  plan: ColorPlan;
  refs: Map<string, NonNullable<TimelineClip["projectItem"]>>;
}

export function buildPlan(data: TimelineData, rules: ColorRules, only?: CategoryId[]): PlanWithRefs {
  const enabled = new Set(rules.categories.filter((c) => c.enabled).map((c) => c.id));
  const groups = new Map<
    string,
    { clip: TimelineClip; votes: Map<CategoryId, { n: number; reason: string }>; clips: number }
  >();
  const refs = new Map<string, NonNullable<TimelineClip["projectItem"]>>();
  let skipped = 0;

  for (const clip of data.clips) {
    if (!clip.projectItem || !clip.projectItemId) {
      skipped++;
      continue;
    }
    const c: Classification = classify(clip, rules);
    let g = groups.get(clip.projectItemId);
    if (!g) {
      g = { clip, votes: new Map(), clips: 0 };
      groups.set(clip.projectItemId, g);
      refs.set(clip.projectItemId, clip.projectItem);
    }
    g.clips++;
    const v = g.votes.get(c.category) ?? { n: 0, reason: c.reason };
    v.n++;
    g.votes.set(c.category, v);
  }

  const items: PlannedItem[] = [];
  for (const [id, g] of groups) {
    // Видеофайл со звуком: картинка на V-дорожке и звук на A-дорожке — это нормально, красим как видео.
    const cams = g.votes.get("camera_audio");
    const vid = g.votes.get("video");
    if (cams && vid) {
      vid.n += cams.n;
      g.votes.delete("camera_audio");
    }
    const sorted = [...g.votes.entries()].sort((a, b) => b[1].n - a[1].n);
    const [category, vote] = sorted[0];
    if (!enabled.has(category)) continue;
    if (only && only.length && !only.includes(category)) continue;
    const label = rules.categories.find((c) => c.id === category)!.label;
    items.push({
      projectItemId: id,
      name: g.clip.clipName || g.clip.mediaPath.split(/[\\/]/).pop() || "без имени",
      category,
      label,
      currentLabel: g.clip.currentLabel,
      clips: g.clips,
      reason: vote.reason,
      conflict: sorted.length > 1,
    });
  }

  const byCategory = CATEGORY_ORDER.map((cat) => {
    const list = items.filter((i) => i.category === cat);
    return {
      category: cat,
      name: categoryName(rules, cat),
      label: rules.categories.find((c) => c.id === cat)!.label,
      clips: list.reduce((s, i) => s + i.clips, 0),
      items: list.length,
      changes: list.filter((i) => i.currentLabel !== i.label).length,
    };
  }).filter((c) => c.items > 0);

  return {
    plan: {
      sequenceName: data.sequenceName,
      totalClips: data.clips.length,
      items,
      toChange: items.filter((i) => i.currentLabel !== i.label).length,
      byCategory,
      skipped,
    },
    refs,
  };
}

export async function planColoring(rules: ColorRules, only?: CategoryId[]): Promise<PlanWithRefs> {
  return buildPlan(await readTimeline(), rules, only);
}

/** Применяет план одной транзакцией. Возвращает число перекрашенных элементов. */
export async function applyPlan({ plan, refs }: PlanWithRefs): Promise<number> {
  const p = ppro();
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const changes = plan.items.filter((i) => i.currentLabel !== i.label);
  if (changes.length === 0) return 0;

  let ok = false;
  let error: unknown = null;
  project.lockedAccess(() => {
    try {
      ok = project.executeTransaction((compound) => {
        for (const item of changes) {
          const ref = refs.get(item.projectItemId);
          if (ref) compound.addAction(ref.createSetColorLabelAction(labelIndexFromKey(item.label)));
        }
      }, "Ассистент: покраска таймлайна");
    } catch (err) {
      error = err;
    }
  });
  if (error) throw new HostToolError(`Premiere не дал изменить цвета: ${(error as Error)?.message ?? error}`);
  if (!ok) throw new HostToolError("Premiere отклонил изменение цветов (транзакция не выполнена).");
  return changes.length;
}

/** Короткая сводка для модели и для лога. */
export function planSummary(plan: ColorPlan): string {
  if (plan.items.length === 0) return `В секвенции «${plan.sequenceName}» нечего красить.`;
  const lines = plan.byCategory.map(
    (c) => `${c.name} → ${LABELS[c.label].name}: ${c.clips} клип(ов), файлов ${c.items}, поменяют цвет ${c.changes}`,
  );
  return `Секвенция «${plan.sequenceName}», клипов ${plan.totalClips}.\n${lines.join("\n")}`;
}
