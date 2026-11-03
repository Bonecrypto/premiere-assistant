import { HostToolError } from "../hostTools/types.ts";
import type { AnimOptions, AnimPreset } from "../presets/animations.ts";
import { selectedVideoItems } from "./motion.ts";
import { ppro } from "./timeline.ts";
import { curveKeys, frameSeconds } from "./graph.ts";
import { wobbleAt } from "../presets/wobble.ts";

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
  value: Val;
}

const GBLUR_NAMES = {
  amount: ["blurriness", "размытость", "размытие", "степень размытия"],
  repeat: ["repeat edge pixels", "повторять краевые пиксели", "повторять пиксели краев"],
};

async function gaussianMatchName(): Promise<string | null> {
  const names: string[] = await (ppro() as any).VideoFilterFactory.getMatchNames();
  return names.find((n) => n === "AE.ADBE Gaussian Blur 2") ?? names.find((n) => /gaussian/i.test(n)) ?? null;
}

function pickByName(comp: any, names: string[], index: number): P | null {
  const n: number = comp.getParamCount();
  const list: P[] = [];
  for (let i = 0; i < n; i++) list.push(comp.getParam(i));
  return list.find((p) => names.includes(String(p.displayName ?? "").trim().toLowerCase())) ?? list[index] ?? null;
}

type Val = number | { x: number; y: number };
const lerp = (a: Val, b: Val, t: number): Val =>
  typeof a === "number" ? a + ((b as number) - a) * t : { x: a.x + ((b as any).x - a.x) * t, y: a.y + ((b as any).y - a.y) * t };

/** Отрезок анимации: в extremeAt — «крайнее» состояние, в normalAt — обычное. */
interface Segment {
  extremeAt: number;
  normalAt: number;
  /** -1 — выход в противоположную сторону (проезд). */
  sign: 1 | -1;
}

/** Псевдослучайные, но повторяемые смещения для тряски. */
const SHAKE = [
  [1, -0.6], [-0.8, 0.9], [0.5, 0.7], [-1, -0.3], [0.7, -1], [-0.4, 0.8], [0.9, 0.2], [-0.6, -0.9], [0.3, 1], [-0.9, 0.4],
];

export async function animateSelected(preset: AnimPreset, baseOpt: AnimOptions): Promise<AnimResult> {
  const opt: AnimOptions = {
    ...baseOpt,
    ...(preset.easing ? { easing: preset.easing } : {}),
    ...(typeof preset.blur === "boolean" ? { blur: preset.blur } : {}),
    ...(preset.distance ? { distance: preset.distance } : {}),
  };
  const p = ppro() as any;
  const { project, frame, items } = await selectedVideoItems();
  const matchName = await transformMatchName();
  const blurAmt = Math.max(0, preset.blurAmt ?? 0);
  const gName = blurAmt > 0 ? await gaussianMatchName() : null;
  if (blurAmt > 0 && !gName) throw new HostToolError("В этой версии Premiere не нашёл эффект Gaussian Blur.");
  const skipped: AnimResult["skipped"] = [];

  // 1. Добавить Transform (и Gaussian Blur для размытия) тем клипам, у кого их нет.
  const toAppend: Array<{ chain: any; component: any }> = [];
  for (const item of items) {
    if (!(await findTransform(item, matchName))) {
      toAppend.push({ chain: await item.getComponentChain(), component: await p.VideoFilterFactory.createComponent(matchName) });
    }
    if (gName && !(await findTransform(item, gName))) {
      toAppend.push({ chain: await item.getComponentChain(), component: await p.VideoFilterFactory.createComponent(gName) });
    }
  }
  if (toAppend.length) {
    run(project, gName ? "Ассистент: эффекты Transform и Gaussian Blur" : "Ассистент: эффект Transform", (c) => {
      for (const a of toAppend) c.addAction(a.chain.createAppendComponentAction(a.component));
    });
  }

  // 2. Посчитать ключевые кадры для каждого клипа.
  const keys: Key[] = [];
  const timeVarying = new Set<P>();
  const staticSets: Array<{ param: P; value: number | boolean }> = [];
  const linearKeys = new Set<Key>();
  const W = frame.w;
  const H = frame.h;
  const dist = (opt.distance || 100) / 100;
  const curve = preset.curve && preset.curve.length === 4 ? preset.curve : null;
  // Со своим графиком «пружину» задаёт сама кривая.
  const over = curve ? 0 : Math.max(0, Math.min(60, preset.overshoot ?? 0)) / 100;
  const frameSec = curve ? await frameSeconds(await project.getActiveSequence()) : 1 / 30;
  const shake = Math.max(0, preset.shake ?? 0) / 100;
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
    const endS = outS - Math.min(0.01, len / 100);
    const want = preset.duration ?? opt.duration;
    const d = Math.min(want, preset.kind === "whole" ? len : preset.kind === "both" ? len / 2.2 : len / 2);
    const segs: Segment[] =
      preset.kind === "in"
        ? [{ extremeAt: inS, normalAt: inS + d, sign: 1 }]
        : preset.kind === "out"
          ? [{ extremeAt: endS, normalAt: endS - d, sign: 1 }]
          : preset.kind === "whole"
            ? [{ extremeAt: endS, normalAt: inS, sign: 1 }]
            : [
                { extremeAt: inS, normalAt: inS + d, sign: 1 },
                { extremeAt: endS, normalAt: endS - d, sign: preset.through ? -1 : 1 },
              ];
    const tNormal = p.TickTime.createWithSeconds(segs[0].normalAt);

    const pos = pointOf(await valueAt(prm.position, tNormal));
    if (!pos) {
      skipped.push({ name, why: "не удалось прочитать Position" });
      continue;
    }
    const norm = Math.abs(pos.x) <= 2 && Math.abs(pos.y) <= 2;
    const toUnits = (px: number, py: number) => (norm ? { x: px / W, y: py / H } : { x: px, y: py });

    /** Ключи свойства: обычное значение, крайнее (по знаку отрезка), перелёт для «пружины». */
    const add = (param: P | null, normal: Val, extreme: (sign: 1 | -1) => Val, canOvershoot: boolean) => {
      if (!param) return;
      timeVarying.add(param);
      for (const s of segs) {
        const ext = extreme(s.sign);
        if (curve) {
          // Свой график: ключи на каждом кадре по кривой, интерполяция линейная.
          const [t0, v0, t1, v1] = s.extremeAt < s.normalAt ? [s.extremeAt, ext, s.normalAt, normal] : [s.normalAt, normal, s.extremeAt, ext];
          const lo = typeof v0 === "number" ? Math.min(v0, v1 as number) : 0;
          const hi = typeof v0 === "number" ? Math.max(v0, v1 as number) : 0;
          for (const k of curveKeys(t0, t1, v0, v1, curve, frameSec, true)) {
            // Прозрачность и размытие не должны «перелетать» за свои пределы.
            const v = !canOvershoot && typeof k.v === "number" ? Math.max(lo, Math.min(hi, k.v)) : k.v;
            keys.push({ param, seconds: k.t, value: v });
          }
          continue;
        }
        keys.push({ param, seconds: s.normalAt, value: normal });
        keys.push({ param, seconds: s.extremeAt, value: ext });
        if (canOvershoot && over > 0) {
          // Перелёт (на входе) или замах (на выходе) — ближе к обычной точке.
          keys.push({ param, seconds: s.extremeAt + (s.normalAt - s.extremeAt) * 0.72, value: lerp(normal, ext, -over) });
        }
      }
    };

    if ((preset.wobble ?? 0) > 0) {
      // Покачивание (camera wobble): плавное блуждание Position (+ поворот) на весь клип, ключи ~4 на колебание, Bezier.
      const hz = Math.max(0.2, Math.min(6, preset.wobbleHz ?? 1.2));
      const amp = (preset.wobble ?? 0) / 100;
      const rotAmp = preset.wobbleRot ?? 0;
      const r0 = prm.rotation ? numberOf(await valueAt(prm.rotation, tNormal)) ?? 0 : 0;
      const n = Math.max(4, Math.min(400, Math.ceil(((endS - inS) * hz * 4))));
      timeVarying.add(prm.position);
      if (prm.rotation && rotAmp) timeVarying.add(prm.rotation);
      for (let i = 0; i <= n; i++) {
        const t = inS + ((endS - inS) * i) / n;
        const ramp = Math.min(1, (t - inS) / 0.3); // без рывка в начале клипа
        const w = wobbleAt(t - inS, hz);
        const off = toUnits(w.x * amp * W * ramp, w.y * amp * H * ramp);
        keys.push({ param: prm.position, seconds: t, value: { x: pos.x + off.x, y: pos.y + off.y } });
        if (prm.rotation && rotAmp) keys.push({ param: prm.rotation, seconds: t, value: r0 + w.r * rotAmp * ramp });
      }
    } else if (shake > 0) {
      // Тряска: частые ключи Position с затуханием (на входе) или нарастанием (на выходе).
      timeVarying.add(prm.position);
      const step = 1 / 24;
      const [t0, t1] = preset.kind === "out" ? [endS - d, endS] : preset.kind === "whole" ? [inS, endS] : [inS, inS + d];
      const n = Math.max(3, Math.min(60, Math.floor((t1 - t0) / step)));
      for (let i = 0; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n;
        const life = preset.kind === "out" ? i / n : preset.kind === "whole" ? 1 : 1 - i / n;
        const edge = (preset.kind === "out" && i === 0) || (preset.kind !== "out" && preset.kind !== "whole" && i === n);
        const [sx, sy] = SHAKE[i % SHAKE.length];
        const off = edge ? { x: 0, y: 0 } : toUnits(sx * shake * W * life, sy * shake * H * life);
        const k: Key = { param: prm.position, seconds: t, value: { x: pos.x + off.x, y: pos.y + off.y } };
        keys.push(k);
        linearKeys.add(k);
      }
    } else if (preset.dx || preset.dy) {
      add(
        prm.position,
        pos,
        (sign) => {
          const u = toUnits(preset.dx * W * dist * sign, preset.dy * H * dist * sign);
          return { x: pos.x + u.x, y: pos.y + u.y };
        },
        true,
      );
    }
    if (preset.scale !== 100) {
      const sc = numberOf(await valueAt(prm.scale, tNormal)) ?? 100;
      add(prm.scale, sc, () => (sc * preset.scale) / 100, true);
    }
    if (preset.rotation) {
      const r = prm.rotation ? numberOf(await valueAt(prm.rotation, tNormal)) ?? 0 : 0;
      add(prm.rotation, r, (sign) => r + preset.rotation * sign, true);
    }
    if (preset.fade) {
      const o = prm.opacity ? numberOf(await valueAt(prm.opacity, tNormal)) ?? 100 : 100;
      add(prm.opacity, o, () => 0, false);
    }
    if (gName) {
      const g = await findTransform(item, gName);
      const amount = g ? pickByName(g, GBLUR_NAMES.amount, 0) : null;
      if (amount) {
        add(amount, 0, () => blurAmt, false);
        const rep = pickByName(g, GBLUR_NAMES.repeat, 2);
        if (rep) staticSets.push({ param: rep, value: true });
      } else skipped.push({ name, why: "не нашёл параметр размытия" });
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

  // 5. Плавность (Bezier) или линейно; тряска — всегда линейно.
  const modes = p.Constants?.InterpolationMode ?? {};
  // Со своим графиком — несколько ключей по кривой, между ними Bezier (без «частокола» ключей).
  const mode = curve || opt.easing === "bezier" ? modes.BEZIER : modes.LINEAR;
  if (typeof mode === "number") {
    try {
      run(project, "Ассистент: плавность", (c) => {
        for (const k of keys) {
          const m = linearKeys.has(k) && typeof modes.LINEAR === "number" ? modes.LINEAR : mode;
          c.addAction(k.param.createSetInterpolationAtKeyframeAction(p.TickTime.createWithSeconds(k.seconds), m, true));
        }
      });
    } catch {
      /* плавность — не критично */
    }
  }

  return { changed, skipped };
}
