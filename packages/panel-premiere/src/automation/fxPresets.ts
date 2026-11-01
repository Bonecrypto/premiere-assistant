import { storageGet, storageSet } from "../env.ts";
import { HostToolError } from "../hostTools/types.ts";
import { ppro } from "./timeline.ts";

/**
 * «Мои пресеты эффектов»: сохранить эффекты выделенного клипа (с настройками) и применить к другим.
 * Premiere UXP API 25.6+: getComponentChain → Component.getMatchName/getDisplayName/getParam →
 * ComponentParam.getStartValue; применение — VideoFilterFactory.createComponent (видео),
 * AudioFilterFactory.createComponentByDisplayName (звук) + createAppendComponentAction,
 * затем ComponentParam.createSetValueAction. Анимированные (с ключами) параметры не сохраняются.
 */

type Value =
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "str"; v: string }
  | { t: "point"; x: number; y: number }
  | { t: "color"; r: number; g: number; b: number; a: number };

interface SavedParam {
  i: number;
  name: string;
  value: Value;
}

interface SavedComponent {
  matchName: string;
  displayName: string;
  params: SavedParam[];
}

export interface FxPreset {
  id: string;
  name: string;
  kind: "video" | "audio";
  components: SavedComponent[];
  createdAt: number;
}

const KEY = "fxPresets";
/** Встроенные эффекты клипа — их не добавляют, а настраивают существующие. */
const INTRINSIC = /motion|opacity|time\s*remap|volume|panner|channel/i;

export function loadFxPresets(): FxPreset[] {
  try {
    const list = JSON.parse(storageGet(KEY) || "[]");
    return Array.isArray(list) ? list.filter((p) => p && p.id && Array.isArray(p.components)) : [];
  } catch {
    return [];
  }
}

export function saveFxPresets(list: FxPreset[]): void {
  storageSet(KEY, JSON.stringify(list));
}

function toValue(raw: any): Value | null {
  const v = raw?.value?.value ?? raw?.value ?? raw;
  if (typeof v === "number" && Number.isFinite(v)) return { t: "num", v };
  if (typeof v === "boolean") return { t: "bool", v };
  if (typeof v === "string") return { t: "str", v };
  if (v && typeof v.x === "number" && typeof v.y === "number") return { t: "point", x: v.x, y: v.y };
  if (v && typeof v.red === "number") return { t: "color", r: v.red, g: v.green, b: v.blue, a: v.alpha ?? 1 };
  return null;
}

function fromValue(p: any, v: Value): unknown {
  switch (v.t) {
    case "num":
    case "bool":
    case "str":
      return v.v;
    case "point":
      return new p.PointF(v.x, v.y);
    case "color":
      return typeof p.Color === "function" ? new p.Color(v.r, v.g, v.b, v.a) : null;
  }
}

async function selection() {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new HostToolError("Нет активной секвенции.");
  const sel = await sequence.getSelection();
  const items: any[] = (await sel?.getTrackItems()) ?? [];
  const isVideo = (it: any) => typeof it?.isAdjustmentLayer === "function" && typeof it?.createAddVideoTransitionAction === "function";
  return { p, project, video: items.filter(isVideo), audio: items.filter((it) => !isVideo(it)) };
}

/** Сохранить эффекты первого выделенного клипа. includeBuiltIn — вместе с Motion/Opacity (или Volume). */
export async function captureFxPreset(name: string, includeBuiltIn: boolean): Promise<FxPreset> {
  const { video, audio } = await selection();
  const item = video[0] ?? audio[0];
  if (!item) throw new HostToolError("Выделите на таймлайне клип с эффектами.");
  const kind: FxPreset["kind"] = video[0] ? "video" : "audio";
  const chain = await item.getComponentChain();
  const count: number = chain.getComponentCount();
  const components: SavedComponent[] = [];
  for (let i = 0; i < count; i++) {
    const comp = chain.getComponentAtIndex(i);
    const matchName: string = (await comp.getMatchName()) ?? "";
    if (!matchName) continue;
    if (!includeBuiltIn && INTRINSIC.test(matchName)) continue;
    const displayName: string = (await comp.getDisplayName().catch(() => matchName)) || matchName;
    const params: SavedParam[] = [];
    const pc: number = comp.getParamCount();
    for (let j = 0; j < pc; j++) {
      const prm = comp.getParam(j);
      if (!prm || prm.isTimeVarying?.()) continue;
      try {
        const value = toValue(await prm.getStartValue());
        if (value) params.push({ i: j, name: String(prm.displayName ?? ""), value });
      } catch {
        /* параметр без значения (группа, кнопка) */
      }
    }
    components.push({ matchName, displayName, params });
  }
  if (components.length === 0) {
    throw new HostToolError(includeBuiltIn ? "У клипа нет эффектов." : "У клипа нет добавленных эффектов (кроме встроенных Motion/Opacity).");
  }
  const preset: FxPreset = { id: `fx${Date.now().toString(36)}`, name: name.trim() || "Мой пресет", kind, components, createdAt: Date.now() };
  saveFxPresets([...loadFxPresets(), preset]);
  return preset;
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

async function componentsByMatch(item: any): Promise<Array<{ comp: any; match: string }>> {
  const chain = await item.getComponentChain();
  const out: Array<{ comp: any; match: string }> = [];
  for (let i = 0; i < chain.getComponentCount(); i++) {
    const comp = chain.getComponentAtIndex(i);
    out.push({ comp, match: (await comp.getMatchName()) ?? "" });
  }
  return out;
}

/** Применить пресет к выделенным клипам того же типа (видео/звук). */
export async function applyFxPreset(preset: FxPreset): Promise<{ changed: number; skippedParams: number }> {
  const { p, project, video, audio } = await selection();
  const items = preset.kind === "video" ? video : audio;
  if (items.length === 0) {
    throw new HostToolError(preset.kind === "video" ? "Выделите видеоклипы на таймлайне." : "Выделите аудиоклипы на таймлайне.");
  }

  // 1. Добавить недостающие эффекты (встроенные — не добавляем, а настраиваем существующие).
  const appends: Array<{ chain: any; component: any }> = [];
  // Для каждого клипа запомним, сколько экземпляров каждого эффекта было до добавления.
  const before = new Map<any, Map<string, number>>();
  for (const item of items) {
    const existing = await componentsByMatch(item);
    const counts = new Map<string, number>();
    for (const e of existing) counts.set(e.match, (counts.get(e.match) ?? 0) + 1);
    before.set(item, counts);
    const chain = await item.getComponentChain();
    for (const c of preset.components) {
      if (INTRINSIC.test(c.matchName) && counts.get(c.matchName)) continue;
      const component =
        preset.kind === "video"
          ? await p.VideoFilterFactory.createComponent(c.matchName)
          : await p.AudioFilterFactory.createComponentByDisplayName(c.displayName, item);
      appends.push({ chain, component });
    }
  }
  if (appends.length) {
    run(project, `Ассистент: эффекты «${preset.name}»`, (c) => {
      for (const a of appends) c.addAction(a.chain.createAppendComponentAction(a.component));
    });
  }

  // 2. Перенести значения параметров: для встроенных — в существующий экземпляр,
  //    для добавленных — в только что добавленный (после тех, что были раньше).
  const sets: Array<{ param: any; value: unknown }> = [];
  let skippedParams = 0;
  for (const item of items) {
    const comps = await componentsByMatch(item);
    const counts = before.get(item)!;
    const used = new Map<string, number>();
    for (const c of preset.components) {
      const same = comps.filter((x) => x.match === c.matchName);
      let target: any;
      if (INTRINSIC.test(c.matchName) && (counts.get(c.matchName) ?? 0) > 0) target = same[0]?.comp;
      else {
        const k = (counts.get(c.matchName) ?? 0) + (used.get(c.matchName) ?? 0);
        target = same[k]?.comp;
        used.set(c.matchName, (used.get(c.matchName) ?? 0) + 1);
      }
      if (!target) {
        skippedParams += c.params.length;
        continue;
      }
      for (const sp of c.params) {
        const prm = target.getParam(sp.i);
        const value = fromValue(p, sp.value);
        if (!prm || prm.isTimeVarying?.() || value === null) {
          skippedParams++;
          continue;
        }
        sets.push({ param: prm, value });
      }
    }
  }

  if (sets.length) {
    run(project, `Ассистент: настройки «${preset.name}»`, (c) => {
      for (const s of sets) {
        try {
          c.addAction(s.param.createSetValueAction(s.param.createKeyframe(s.value), true));
        } catch {
          skippedParams++;
        }
      }
    });
  }
  return { changed: items.length, skippedParams };
}
