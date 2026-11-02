import { HostToolError } from "../hostTools/types.ts";
import { storageGet, storageSet } from "../env.ts";
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
  /** 0 — мало ключей (4 отрезка, Bezier: Premiere сам сглаживает — по умолчанию), 1 — каждый кадр, 2 — через кадр. */
  step: 0 | 1 | 2;
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

function sameVal(a: Val | null, b: Val | null): boolean {
  if (a === null || b === null) return false;
  if (typeof a === "number" || typeof b === "number") return typeof a === typeof b && Math.abs((a as number) - (b as number)) < 1e-6;
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
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

/** Все анимированные параметры клипа (с ключами) + id «компонент.параметр» для реестра наших ключей. */
async function animatedParams(item: any, scope: BakeOptions["scope"]): Promise<Array<{ prm: any; id: string }>> {
  const out: Array<{ prm: any; id: string }> = [];
  const chain = await item.getComponentChain();
  const n: number = chain.getComponentCount();
  for (let i = 0; i < n; i++) {
    const comp = chain.getComponentAtIndex(i);
    const pc: number = comp.getParamCount();
    for (let j = 0; j < pc; j++) {
      const prm = comp.getParam(j);
      if (!prm?.isTimeVarying?.()) continue;
      if (scope === "motion" && !MOTION_NAMES.test(String(prm.displayName ?? ""))) continue;
      out.push({ prm, id: `${i}.${j}` });
    }
  }
  return out;
}

/**
 * «Опорные» ключи параметра: густые серии (запечённые ранее, шаг ≤ 2.5 кадра) схлопываются до крайних ключей.
 * Так кривую можно менять сколько угодно раз — пересчитывается от исходных точек.
 */
function anchors(times: number[], frame: number, ours?: Set<string>): { anchors: number[]; dense: number[] } {
  const mine = times.filter((t) => ours?.has(t.toFixed(3)));
  const sorted = times.filter((t) => !ours?.has(t.toFixed(3))).sort((a, b) => a - b);
  const keep: number[] = [];
  const dense: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const prevGap = i > 0 ? sorted[i] - sorted[i - 1] : Infinity;
    const nextGap = i < sorted.length - 1 ? sorted[i + 1] - sorted[i] : Infinity;
    const inside = prevGap <= frame * 2.5 && nextGap <= frame * 2.5;
    if (inside) dense.push(sorted[i]);
    else keep.push(sorted[i]);
  }
  // Режим «мало ключей»: серия из FEW_SEGMENTS равных промежутков — внутренние ключи тоже наши.
  const k2 = keep;
  const few = new Set<number>();
  for (let i = 0; i + FEW_SEGMENTS < k2.length; i++) {
    const g = k2[i + 1] - k2[i];
    if (g <= frame * 2.5) continue;
    let equal = true;
    for (let j = 1; j < FEW_SEGMENTS; j++) {
      if (Math.abs(k2[i + j + 1] - k2[i + j] - g) > frame * 0.6) equal = false;
    }
    if (equal) for (let j = 1; j < FEW_SEGMENTS; j++) few.add(k2[i + j]);
  }
  return { anchors: keep.filter((t) => !few.has(t)), dense: [...dense, ...few, ...mine] };
}

// ───────── Реестр «наших» ключей: чтобы повторное применение заменяло их, а не копило ─────────

const REG_KEY = "bakedKeys";

function loadRegistry(): Record<string, number[]> {
  try {
    const v = JSON.parse(storageGet(REG_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function saveRegistry(r: Record<string, number[]>): void {
  // Не даём реестру расти бесконечно.
  const keys = Object.keys(r);
  if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete r[k];
  storageSet(REG_KEY, JSON.stringify(r));
}

const regId = (clip: string, id: string) => `${clip}::${id}`;
const asSet = (list?: number[]) => new Set((list ?? []).map((t) => t.toFixed(3)));

/**
 * Где ставить дополнительные ключи в режиме «мало»: в моменты, когда движение проходит 1/4, 1/2, 3/4 пути
 * (для кривых без перелёта) — так ключи сгущаются там, где скорость меняется сильнее. Иначе — равномерно.
 */
export function fewFractions(curve: Curve): number[] {
  const [, y1, , y2] = curve;
  if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1) return [0.25, 0.5, 0.75];
  const ease = easeFn(curve);
  return [0.25, 0.5, 0.75].map((y) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (ease(mid) < y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  });
}

/** Доли → времена ключей: на целых кадрах, не ближе кадра к соседям и концам отрезка. */
function fewTimes(t0: number, t1: number, fr: number[], frame: number): number[] {
  const out: number[] = [];
  let prev = t0;
  for (const f of fr) {
    const t = Math.round((t0 + (t1 - t0) * f) / frame) * frame;
    if (t - prev >= frame * 0.99 && t1 - t >= frame * 0.99) {
      out.push(t);
      prev = t;
    }
  }
  return out;
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
    const reg = loadRegistry();
    if (prms.length === 0) {
      res.skipped.push(`${name}: нет ключевых кадров`);
      continue;
    }
    let used = false;
    for (const { prm, id } of prms) {
      const times = await keyTimes(prm);
      if (times.length < 2) continue;
      const rid = regId(name, id);
      const { anchors: pts, dense } = anchors(times, frame, asSet(reg[rid]));
      if (pts.length < 2) continue;
      // Значения опорных ключей.
      const vals: Array<Val | null> = [];
      for (const t of pts) vals.push(valOf(await prm.getValueAtTime(p.TickTime.createWithSeconds(t)).catch(() => null)));
      let segs = 0;
      const newReg: number[] = [];
      for (let s = 0; s < pts.length - 1; s++) {
        const a = vals[s];
        const b = vals[s + 1];
        if (a === null || b === null || typeof a !== typeof b) continue;
        const t0 = pts[s];
        const t1 = pts[s + 1];
        if (opt.step === 0) {
          const ts = fewTimes(t0, t1, fewFractions(curve), frame);
          if (!ts.length) continue;
          for (const t of ts) {
            adds.push({ param: prm, t, v: lerp(a, b, ease((t - t0) / (t1 - t0))) });
            newReg.push(t);
          }
        } else {
          const n = Math.floor((t1 - t0) / (frame * opt.step));
          if (n < 2 || (t1 - t0) / n < frame * 0.9) continue;
          for (let i = 1; i < n; i++) {
            const t = t0 + ((t1 - t0) * i) / n;
            adds.push({ param: prm, t, v: lerp(a, b, ease(i / n)) });
            newReg.push(t);
          }
        }
        segs++;
      }
      if (segs === 0) continue;
      for (const t of dense) removes.push({ param: prm, t });
      anchorMap.set(prm, pts);
      reg[rid] = newReg;
      saveRegistry(reg);
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
  // Мало ключей — Bezier (Premiere сглаживает между ними); каждый кадр — Linear (форму задают сами ключи).
  const MODE = opt.step === 0 ? p.Constants?.InterpolationMode?.BEZIER : p.Constants?.InterpolationMode?.LINEAR;
  if (typeof MODE === "number") {
    try {
      run(project, "Ассистент: график — плавность", (c) => {
        for (const a of adds) c.addAction(a.param.createSetInterpolationAtKeyframeAction(p.TickTime.createWithSeconds(a.t), MODE, false));
        for (const [param, pts] of anchorMap) {
          for (const t of pts) c.addAction(param.createSetInterpolationAtKeyframeAction(p.TickTime.createWithSeconds(t), MODE, false));
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
export async function unbakeCurve(onlyOurs = false): Promise<{ removed: number }> {
  const { p, project, sequence, items } = await selectedClips();
  const frame = await frameSeconds(sequence);
  const removes: Array<{ param: any; t: number }> = [];
  const keepers: Array<{ param: any; t: number }> = [];
  const reg = loadRegistry();
  for (const item of items) {
    const name: string = (await item.getName?.().catch(() => "")) || "клип";
    for (const { prm, id } of await animatedParams(item, "all")) {
      const rid = regId(name, id);
      const times = await keyTimes(prm);
      const ours = asSet(reg[rid]);
      const { anchors: pts, dense } = onlyOurs
        ? { anchors: times.filter((t) => !ours.has(t.toFixed(3))), dense: times.filter((t) => ours.has(t.toFixed(3))) }
        : anchors(times, frame, ours);
      dense.forEach((t) => removes.push({ param: prm, t }));
      pts.forEach((t) => keepers.push({ param: prm, t }));
      delete reg[rid];
    }
  }
  saveRegistry(reg);
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
/** Сколько отрезков в режиме «мало ключей». */
export const FEW_SEGMENTS = 4;

export function curveKeys(t0: number, t1: number, v0: Val, v1: Val, curve: Curve, frame: number, few = false): Array<{ t: number; v: Val }> {
  const ease = easeFn(curve);
  if (few) {
    const ts = [t0, ...fewTimes(t0, t1, fewFractions(curve), frame), t1];
    return ts.map((t) => ({ t, v: lerp(v0, v1, ease((t - t0) / (t1 - t0))) }));
  }
  const n = Math.max(2, Math.round(Math.abs(t1 - t0) / frame));
  const out: Array<{ t: number; v: Val }> = [];
  for (let i = 0; i <= n; i++) out.push({ t: t0 + ((t1 - t0) * i) / n, v: lerp(v0, v1, ease(i / n)) });
  return out;
}

export { frameSeconds };

// ───────── Быстрые графики: тип плавности у СУЩЕСТВУЮЩИХ ключей (новые не создаются) ─────────

export type QuickEase = "linear" | "bezier" | "hold" | "ease-in" | "ease-out" | "easy-ease" | "launch" | "trampoline";

export interface QuickResult {
  clips: number;
  params: number;
  keys: number;
  /** Режим недоступен в этой версии Premiere. */
  unsupported?: string;
}

/**
 * Ставит тип интерполяции ключам выделенных клипов — как правый клик по ключам в Effect Controls.
 * Premiere UXP API: ComponentParam.createSetInterpolationAtKeyframeAction(time, Constants.InterpolationMode.*).
 * Linear / Bezier / Hold есть точно. Ease In / Ease Out — через TIME_TRANSITION_END / TIME_TRANSITION_START (проверяется).
 * «Easy Ease»: первому ключу отрезка — Ease Out, последнему — Ease In, средним — Bezier.
 * Если на клипе был «запечённый» график — тип ставится только опорным ключам.
 */
export async function applyQuickEase(kind: QuickEase, scope: BakeOptions["scope"]): Promise<QuickResult> {
  const { p, project, sequence, items } = await selectedClips();
  const M = p.Constants?.InterpolationMode ?? {};
  const mode = (name: string): number | null => (typeof M[name] === "number" ? M[name] : null);
  const need: Record<QuickEase, string[]> = {
    linear: ["LINEAR"],
    bezier: ["BEZIER"],
    hold: ["HOLD"],
    "ease-in": ["TIME_TRANSITION_END"],
    "ease-out": ["TIME_TRANSITION_START"],
    "easy-ease": ["TIME_TRANSITION_START", "TIME_TRANSITION_END", "BEZIER"],
    launch: ["LINEAR", "BEZIER"],
    trampoline: ["LINEAR", "BEZIER"],
  };
  const missing = need[kind].filter((n) => mode(n) === null);
  if (missing.length) throw new HostToolError(`Этот тип плавности недоступен в вашей версии Premiere (${missing.join(", ")}).`);

  // Если раньше применяли «точный» график — сначала убрать наши доп. ключи, чтобы остались только ключи пользователя.
  try {
    await unbakeCurve(true);
  } catch {
    /* наших ключей нет */
  }
  const frame = await frameSeconds(sequence);
  const sets: Array<{ param: any; t: number; m: number }> = [];
  const res: QuickResult = { clips: 0, params: 0, keys: 0 };
  for (const item of items) {
    let used = false;
    for (const { prm } of await animatedParams(item, scope)) {
      const times = (await keyTimes(prm)).sort((a, b) => a - b);
      if (times.length === 0) continue;
      // Наши доп. ключи уже убраны (unbakeCurve(true)) — остальные ключи пользователя, берём все.
      // Для прочих режимов — опорные (без старых «частоколов» без реестра).
      const shaped = kind === "launch" || kind === "trampoline";
      const { anchors: pts } = anchors(times, frame);
      const keys = shaped || !pts.length ? times : pts;
      // Где движение начинается и где заканчивается — по значениям ключей.
      const vals: Array<Val | null> = shaped
        ? await Promise.all(keys.map(async (t) => valOf(await Promise.resolve(prm.getValueAtTime(p.TickTime.createWithSeconds(t))).catch(() => null))))
        : [];
      const moves = (i: number) => i >= 0 && i < keys.length - 1 && !sameVal(vals[i], vals[i + 1]);
      keys.forEach((t, i) => {
        let m: number;
        if (kind === "launch") {
          // Вылет: ключ, с которого начинается движение, — Linear (сразу на скорости); где оно кончается — Bezier (торможение).
          m = moves(i) && !moves(i - 1) ? mode("LINEAR")! : mode("BEZIER")!;
        } else if (kind === "trampoline") {
          // Трамплин: ключ, где движение кончается, — Linear (влетает на скорости); старт — Bezier (мягкий разгон).
          m = moves(i - 1) && !moves(i) ? mode("LINEAR")! : mode("BEZIER")!;
        } else if (kind === "easy-ease") {
          m = i === 0 ? mode("TIME_TRANSITION_START")! : i === keys.length - 1 ? mode("TIME_TRANSITION_END")! : mode("BEZIER")!;
        } else {
          m = mode(need[kind][0])!;
        }
        sets.push({ param: prm, t, m });
      });
      res.params++;
      res.keys += keys.length;
      used = true;
    }
    if (used) res.clips++;
  }
  if (!sets.length) throw new HostToolError("У выделенных клипов нет ключевых кадров.");
  run(project, "Ассистент: тип плавности ключей", (c) => {
    for (const s of sets) c.addAction(s.param.createSetInterpolationAtKeyframeAction(p.TickTime.createWithSeconds(s.t), s.m, true));
  });
  return res;
}
