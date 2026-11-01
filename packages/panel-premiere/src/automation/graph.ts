import { HostToolError } from "../hostTools/types.ts";
import { easeFn, type Curve } from "../presets/curves.ts";
import { ppro } from "./timeline.ts";

/**
 * «Графики»: своя кривая плавности для анимации выделенных клипов.
 * Premiere UXP API не даёт двигать ручки Безье у ключей (есть только режим: Bezier/Linear/Hold),
 * поэтому кривая «запекается»: между двумя ключами ставятся ключи на каждом кадре (или через кадр)
 * со значениями по кривой, интерполяция — Linear. Результат — точно по графику.
 *
 * API: ComponentParam.getKeyframeListAsTickTimes / getValueAtTime / createKeyframe + createAddKeyframeAction /
 * createRemoveKeyframeAction / createSetInterpolationAtKeyframeAction; Sequence.getTimebase — длина кадра.
 */

const TICKS_PER_SECOND = 254016000000;

export interface BakeOptions {
  /** Шаг ключей в кадрах: 1 — каждый кадр (точнее), 2 — через кадр (легче). */
  step: 1 | 2;
  /** Какие параметры: все анимированные или только движение (Position/Scale/Rotation/Opacity). */
  scope: "all" | "motion";
}

export interface BakeResult {
  clips: number;
  params: number;
  segments: number;
  keys: number;
  skipped: string[];
}

const MOTION_NAMES = /position|scale|rotation|opacity|anchor|положение|позиция|масштаб|поворот|вращение|непрозрачн|прозрачн|опорн/i;

type Val = number | { x: number; y: number };

function valOf(v: any): Val | null {
  const x = v?.value?.value ?? v?.value ?? v;
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (x && typeof x.x === "number" && typeof x.y === "number") return { x: x.x, y: x.y };
  return null;
}

function lerp(a: Val, b: Val, k: number): Val {
  if (typeof a === "number") return a + ((b as number) - a) * k;
  const bb = b as { x: number; y: number };
  return { x: a.x + (bb.x - a.x) * k, y: a.y + (bb.y - a.y) * k };
}

async function frameSeconds(sequence: any): Promise<number> {
  try {
    const tb = Number(await sequence.getTimebase());
    if (tb > 0) return tb / TICKS_PER_SECOND;
  } catch {
    /* по умолчанию 30 к/с */
  }
  return 1 / 30;
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

async function selectedClips() {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new HostToolError("Нет активной секвенции.");
  const sel = await sequence.getSelection();
  const items: any[] = (await sel?.getTrackItems()) ?? [];
  if (items.length === 0) throw new HostToolError("Выделите на таймлайне клипы с ключевыми кадрами.");
  return { p, project, sequence, items };
}

/** Времена ключей параметра, с. В типах метод синхронный, но на всякий случай ждём и Promise. */
async function keyTimes(prm: any): Promise<number[]> {
  try {
    const list: any[] = (await Promise.resolve(prm.getKeyframeListAsTickTimes?.())) ?? [];
    return list.map((t) => Number(t?.seconds)).filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

/** Все анимированные параметры клипа (с ключами). */
async function animatedParams(item: any, scope: BakeOptions["scope"]): Promise<any[]> {
  const out: any[] = [];
  const chain = await item.getComponentChain();
  const n: number = chain.getComponentCount();
  for (let i = 0; i < n; i++) {
    const comp = chain.getComponentAtIndex(i);
    const pc: number = comp.getParamCount();
    for (let j = 0; j < pc; j++) {
      const prm = comp.getParam(j);
      if (!prm?.isTimeVarying?.()) continue;
      if (scope === "motion" && !MOTION_NAMES.test(String(prm.displayName ?? ""))) continue;
      out.push(prm);
    }
  }
  return out;
}

/**
 * «Опорные» ключи параметра: густые серии (запечённые ранее, шаг ≤ 2.5 кадра) схлопываются до крайних ключей.
 * Так кривую можно менять сколько угодно раз — пересчитывается от исходных точек.
 */
function anchors(times: number[], frame: number): { anchors: number[]; dense: number[] } {
  const sorted = [...times].sort((a, b) => a - b);
  const keep: number[] = [];
  const dense: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const prevGap = i > 0 ? sorted[i] - sorted[i - 1] : Infinity;
    const nextGap = i < sorted.length - 1 ? sorted[i + 1] - sorted[i] : Infinity;
    const inside = prevGap <= frame * 2.5 && nextGap <= frame * 2.5;
    if (inside) dense.push(sorted[i]);
    else keep.push(sorted[i]);
  }
  return { anchors: keep, dense };
}

/** Применить кривую ко всем отрезкам между опорными ключами выделенных клипов. */
export async function bakeCurve(curve: Curve, opt: BakeOptions): Promise<BakeResult> {
  const { p, project, sequence, items } = await selectedClips();
  const frame = await frameSeconds(sequence);
  const ease = easeFn(curve);
  const res: BakeResult = { clips: 0, params: 0, segments: 0, keys: 0, skipped: [] };

  const removes: Array<{ param: any; t: number }> = [];
  const adds: Array<{ param: any; t: number; v: Val }> = [];
  const anchorMap = new Map<any, number[]>();

  for (const item of items) {
    const name: string = (await item.getName?.().catch(() => "")) || "клип";
    const prms = await animatedParams(item, opt.scope);
    if (prms.length === 0) {
      res.skipped.push(`${name}: нет ключевых кадров`);
      continue;
    }
    let used = false;
    for (const prm of prms) {
      const times = await keyTimes(prm);
      if (times.length < 2) continue;
      const { anchors: pts, dense } = anchors(times, frame);
      if (pts.length < 2) continue;
      // Значения опорных ключей.
      const vals: Array<Val | null> = [];
      for (const t of pts) vals.push(valOf(await prm.getValueAtTime(p.TickTime.createWithSeconds(t)).catch(() => null)));
      let segs = 0;
      for (let s = 0; s < pts.length - 1; s++) {
        const a = vals[s];
        const b = vals[s + 1];
        if (a === null || b === null || typeof a !== typeof b) continue;
        const t0 = pts[s];
        const t1 = pts[s + 1];
        const n = Math.floor((t1 - t0) / (frame * opt.step));
        if (n < 2) continue;
        for (let i = 1; i < n; i++) {
          const t = t0 + ((t1 - t0) * i) / n;
          adds.push({ param: prm, t, v: lerp(a, b, ease(i / n)) });
        }
        segs++;
      }
      if (segs === 0) continue;
      for (const t of dense) removes.push({ param: prm, t });
      anchorMap.set(prm, pts);
      res.params++;
      res.segments += segs;
      used = true;
    }
    if (used) res.clips++;
    else res.skipped.push(`${name}: ключи слишком близко друг к другу`);
  }

  if (adds.length === 0) throw new HostToolError(res.skipped[0] ?? "Нет отрезков между ключевыми кадрами, к которым можно применить график.");

  // 1. Убрать старые «запечённые» ключи. 2. Поставить новые. 3. Всё — Linear (форму задают сами ключи).
  if (removes.length) {
    run(project, "Ассистент: график — убрать старые ключи", (c) => {
      for (const r of removes) c.addAction(r.param.createRemoveKeyframeAction(p.TickTime.createWithSeconds(r.t), false));
    });
  }
  run(project, "Ассистент: график", (c) => {
    for (const a of adds) {
      const kf = a.param.createKeyframe(typeof a.v === "number" ? a.v : new p.PointF(a.v.x, a.v.y));
      kf.position = p.TickTime.createWithSeconds(a.t);
      c.addAction(a.param.createAddKeyframeAction(kf));
    }
  });
  const LINEAR = p.Constants?.InterpolationMode?.LINEAR;
  if (typeof LINEAR === "number") {
    try {
      run(project, "Ассистент: график — линейно", (c) => {
        for (const a of adds) c.addAction(a.param.createSetInterpolationAtKeyframeAction(p.TickTime.createWithSeconds(a.t), LINEAR, false));
        for (const [param, pts] of anchorMap) {
          for (const t of pts) c.addAction(param.createSetInterpolationAtKeyframeAction(p.TickTime.createWithSeconds(t), LINEAR, false));
        }
      });
    } catch {
      /* не критично */
    }
  }
  res.keys = adds.length;
  return res;
}

/** Убрать запечённые ключи (оставить только опорные) и вернуть обычную плавность Bezier. */
export async function unbakeCurve(): Promise<{ removed: number }> {
  const { p, project, sequence, items } = await selectedClips();
  const frame = await frameSeconds(sequence);
  const removes: Array<{ param: any; t: number }> = [];
  const keepers: Array<{ param: any; t: number }> = [];
  for (const item of items) {
    for (const prm of await animatedParams(item, "all")) {
      const { anchors: pts, dense } = anchors(await keyTimes(prm), frame);
      dense.forEach((t) => removes.push({ param: prm, t }));
      pts.forEach((t) => keepers.push({ param: prm, t }));
    }
  }
  if (removes.length === 0) throw new HostToolError("У выделенных клипов нет запечённых графиков.");
  run(project, "Ассистент: убрать график", (c) => {
    for (const r of removes) c.addAction(r.param.createRemoveKeyframeAction(p.TickTime.createWithSeconds(r.t), false));
  });
  const BEZIER = p.Constants?.InterpolationMode?.BEZIER;
  if (typeof BEZIER === "number") {
    try {
      run(project, "Ассистент: плавность Bezier", (c) => {
        for (const k of keepers) c.addAction(k.param.createSetInterpolationAtKeyframeAction(p.TickTime.createWithSeconds(k.t), BEZIER, true));
      });
    } catch {
      /* не критично */
    }
  }
  return { removed: removes.length };
}

/** Функция-генератор ключей по кривой (общая с анимациями-пресетами). */
export function curveKeys(t0: number, t1: number, v0: Val, v1: Val, curve: Curve, frame: number): Array<{ t: number; v: Val }> {
  const ease = easeFn(curve);
  const n = Math.max(2, Math.round(Math.abs(t1 - t0) / frame));
  const out: Array<{ t: number; v: Val }> = [];
  for (let i = 0; i <= n; i++) out.push({ t: t0 + ((t1 - t0) * i) / n, v: lerp(v0, v1, ease(i / n)) });
  return out;
}

export { frameSeconds };
