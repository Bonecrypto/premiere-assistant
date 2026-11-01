import { HostToolError } from "../hostTools/types.ts";
import type { AnimOptions, AnimPreset } from "../presets/animations.ts";
import { selectedVideoItems } from "./motion.ts";
import { ppro } from "./timeline.ts";

/**
 * Анимация выделенных клипов эффектом Transform (Premiere UXP API 25.6+):
 * VideoFilterFactory.createComponent + createAppendComponentAction — добавить Transform (если его ещё нет);
 * ComponentParam.createSetTimeVaryingAction / createKeyframe + createAddKeyframeAction — ключевые кадры;
 * createSetInterpolationAtKeyframeAction — плавность (Bezier);
 * Use Composition's Shutter Angle = выкл, Shutter Angle = 360 — моушн-блюр.
 * Шаги — отдельными транзакциями, как в официальном примере Adobe (несколько Ctrl+Z).
 */

export interface AnimResult {
  changed: number;
  skipped: Array<{ name: string; why: string }>;
}

const NAMES = {
  position: ["position", "положение", "позиция"],
  scale: ["scale", "scale height", "масштаб", "высота масштаба"],
  rotation: ["rotation", "поворот", "вращение"],
  opacity: ["opacity", "непрозрачность", "прозрачность"],
  useComp: ["use composition's shutter angle", "use composition’s shutter angle", "использовать угол затвора композиции"],
  shutter: ["shutter angle", "угол затвора"],
};
// Стандартный порядок параметров Transform — запасной вариант, если имена на другом языке.
const INDEX = { position: 1, scale: 3, rotation: 7, opacity: 8, useComp: 9, shutter: 10 };

type P = any;

async function transformMatchName(): Promise<string> {
  const names: string[] = await (ppro() as any).VideoFilterFactory.getMatchNames();
  const found =
    names.find((n) => n === "AE.ADBE Geometry2") ?? names.find((n) => /geometry/i.test(n)) ?? names.find((n) => /^AE\.ADBE Transform$/i.test(n));
  if (!found) throw new HostToolError("В этой версии Premiere не нашёл эффект Transform.");
  return found;
}

async function findTransform(item: any, matchName: string): Promise<any | null> {
  const chain = await item.getComponentChain();
  const count: number = chain.getComponentCount();
  for (let i = count - 1; i >= 0; i--) {
    const comp = chain.getComponentAtIndex(i);
    if ((await comp.getMatchName()) === matchName) return comp;
  }
  return null;
}

function params(comp: any): Record<keyof typeof NAMES, P | null> {
  const list: P[] = [];
  const n: number = comp.getParamCount();
  for (let i = 0; i < n; i++) list.push(comp.getParam(i));
  const pick = (key: keyof typeof NAMES) =>
    list.find((p) => NAMES[key].includes(String(p.displayName ?? "").trim().toLowerCase())) ?? list[INDEX[key]] ?? null;
  return {
    position: pick("position"),
    scale: pick("scale"),
    rotation: pick("rotation"),
    opacity: pick("opacity"),
    useComp: pick("useComp"),
    shutter: pick("shutter"),
  };
}

function pointOf(v: any): { x: number; y: number } | null {
  const val = v?.value?.value ?? v?.value ?? v;
  if (!val) return null;
  if (typeof val.x === "number" && typeof val.y === "number") return { x: val.x, y: val.y };
  if (Array.isArray(val) && val.length >= 2) return { x: Number(val[0]), y: Number(val[1]) };
  return null;
}

function numberOf(v: any): number | null {
  const val = v?.value?.value ?? v?.value ?? v;
  return typeof val === "number" ? val : null;
}

/** Значение параметра в момент времени (если уже есть ключи) или постоянное значение. */
async function valueAt(param: P, t: any): Promise<any> {
  try {
    if (param.isTimeVarying?.()) return await param.getValueAtTime(t);
  } catch {
    /* упадём на начальное значение */
  }
  return param.getStartValue();
}

function run(project: any, title: string, fill: (compound: any) => void): void {
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

interface Key {
  param: P;
  seconds: number;
  value: number | { x: number; y: number };
}

export async function animateSelected(preset: AnimPreset, opt: AnimOptions): Promise<AnimResult> {
  const p = ppro() as any;
  const { project, frame, items } = await selectedVideoItems();
  const matchName = await transformMatchName();
  const skipped: AnimResult["skipped"] = [];

  // 1. Добавить Transform тем клипам, у кого его нет.
  const toAppend: Array<{ chain: any; component: any }> = [];
  for (const item of items) {
    if (!(await findTransform(item, matchName))) {
      toAppend.push({ chain: await item.getComponentChain(), component: await p.VideoFilterFactory.createComponent(matchName) });
    }
  }
  if (toAppend.length) {
    run(project, "Ассистент: эффект Transform", (c) => {
      for (const a of toAppend) c.addAction(a.chain.createAppendComponentAction(a.component));
    });
  }

  // 2. Посчитать ключевые кадры для каждого клипа.
  const keys: Key[] = [];
  const timeVarying = new Set<P>();
  const staticSets: Array<{ param: P; value: number | boolean }> = [];
  const W = frame.w;
  const H = frame.h;
  const dist = (opt.distance || 100) / 100;
  let changed = 0;

  for (const item of items) {
    const name: string = (await item.getName().catch(() => "")) || "клип";
    const comp = await findTransform(item, matchName);
    if (!comp) {
      skipped.push({ name, why: "не удалось добавить Transform" });
      continue;
    }
    const prm = params(comp);
    if (!prm.position || !prm.scale) {
      skipped.push({ name, why: "не нашёл параметры Transform" });
      continue;
    }

    const inS: number = (await item.getInPoint()).seconds;
    const outS: number = (await item.getOutPoint()).seconds;
    const len = outS - inS;
    if (len <= 0.05) {
      skipped.push({ name, why: "слишком короткий клип" });
      continue;
    }
    const d = Math.min(preset.duration ?? opt.duration, preset.kind === "whole" ? len : len / 2);
    const endS = outS - Math.min(0.01, len / 100);
    // Две точки анимации: «крайняя» (сдвиг/масштаб/прозрачность) и «обычная».
    const [tA, tB] = preset.kind === "in" ? [inS, inS + d] : preset.kind === "out" ? [endS - d, endS] : [inS, endS];
    const extremeAt = preset.kind === "in" ? tA : tB;
    const normalAt = preset.kind === "in" ? tB : tA;
    const tNormal = p.TickTime.createWithSeconds(normalAt);

    const pos = pointOf(await valueAt(prm.position, tNormal));
    if (!pos) {
      skipped.push({ name, why: "не удалось прочитать Position" });
      continue;
    }
    const norm = Math.abs(pos.x) <= 2 && Math.abs(pos.y) <= 2;
    const shift = { x: preset.dx * W * dist, y: preset.dy * H * dist };
    const target = norm ? { x: pos.x + shift.x / W, y: pos.y + shift.y / H } : { x: pos.x + shift.x, y: pos.y + shift.y };

    const add = (param: P | null, normal: number | { x: number; y: number }, extreme: number | { x: number; y: number }) => {
      if (!param) return;
      timeVarying.add(param);
      keys.push({ param, seconds: normalAt, value: normal });
      keys.push({ param, seconds: extremeAt, value: extreme });
    };

    if (preset.dx || preset.dy) add(prm.position, pos, target);
    if (preset.scale !== 100) {
      const s = numberOf(await valueAt(prm.scale, tNormal)) ?? 100;
      add(prm.scale, s, (s * preset.scale) / 100);
    }
    if (preset.rotation) {
      const r = prm.rotation ? numberOf(await valueAt(prm.rotation, tNormal)) ?? 0 : 0;
      add(prm.rotation, r, r + preset.rotation);
    }
    if (preset.fade) {
      const o = prm.opacity ? numberOf(await valueAt(prm.opacity, tNormal)) ?? 100 : 100;
      add(prm.opacity, o, 0);
    }
    if (opt.blur) {
      if (prm.useComp) staticSets.push({ param: prm.useComp, value: false });
      if (prm.shutter) staticSets.push({ param: prm.shutter, value: 360 });
    }
    changed++;
  }

  if (keys.length === 0) throw new HostToolError(`Не применено: ${skipped[0]?.why ?? "нечего анимировать"}.`);

  // 3. Включить анимацию параметров (секундомер).
  const toEnable = [...timeVarying].filter((prm) => !prm.isTimeVarying?.());
  if (toEnable.length) {
    run(project, "Ассистент: включить анимацию", (c) => {
      for (const prm of toEnable) c.addAction(prm.createSetTimeVaryingAction(true));
    });
  }

  // 4. Ключевые кадры и моушн-блюр.
  run(project, `Ассистент: ${preset.name}`, (c) => {
    for (const k of keys) {
      const v = typeof k.value === "number" ? k.value : new p.PointF(k.value.x, k.value.y);
      const kf = k.param.createKeyframe(v);
      kf.position = p.TickTime.createWithSeconds(k.seconds);
      c.addAction(k.param.createAddKeyframeAction(kf));
    }
    for (const s of staticSets) {
      try {
        c.addAction(s.param.createSetValueAction(s.param.createKeyframe(s.value), true));
      } catch {
        /* если параметр другого типа — пропускаем, анимация важнее */
      }
    }
  });

  // 5. Плавность (Bezier) или линейно.
  const modes = p.Constants?.InterpolationMode ?? {};
  const mode = opt.easing === "bezier" ? modes.BEZIER : modes.LINEAR;
  if (typeof mode === "number") {
    try {
      run(project, "Ассистент: плавность", (c) => {
        for (const k of keys) c.addAction(k.param.createSetInterpolationAtKeyframeAction(p.TickTime.createWithSeconds(k.seconds), mode, true));
      });
    } catch {
      /* плавность — не критично */
    }
  }

  return { changed, skipped };
}
