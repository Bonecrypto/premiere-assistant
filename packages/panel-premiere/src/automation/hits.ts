import { HostToolError } from "../hostTools/types.ts";
import { findEffect, paramBy } from "../graphics/insert.ts";
import { frameSeconds } from "./graph.ts";
import { ppro } from "./timeline.ts";

/**
 * «Удары» — короткие акценты на бит: вспышка, удар-зум, блюр-удар, отдача, твист…
 * Ключи на 3–8 кадров от плейхеда (если он на клипе, иначе с начала клипа) на выделенных видеоклипах.
 * Эффекты стандартные: Brightness & Contrast, Gaussian Blur, Transform (Scale/Rotation, с моушн-блюром).
 */

type Fx = "bc" | "blur" | "tf";

interface Channel {
  fx: Fx;
  param: "brightness" | "blur" | "scale" | "rotation";
  /** [кадр от начала удара, значение] */
  keys: Array<[number, number]>;
}

export interface Hit {
  id: string;
  name: string;
  desc: string;
  channels: Channel[];
}

const FX: Record<Fx, { names: string[]; match: string[]; label: string }> = {
  bc: { names: ["Brightness & Contrast", "Яркость и контрастность", "Яркость и контраст"], match: [], label: "Brightness & Contrast" },
  blur: { names: ["Gaussian Blur", "Размытие по Гауссу"], match: ["AE.ADBE Gaussian Blur 2"], label: "Gaussian Blur" },
  tf: { names: ["Transform", "Преобразовать", "Трансформирование", "Преобразование"], match: ["AE.ADBE Geometry2"], label: "Transform" },
};

const PARAM: Record<Channel["param"], { names: string[]; index: number }> = {
  brightness: { names: ["Brightness", "Яркость"], index: 0 },
  blur: { names: ["Blurriness", "Размытость", "Степень размытия"], index: 0 },
  scale: { names: ["Scale", "Масштаб", "Scale Height", "Высота масштаба"], index: 3 },
  rotation: { names: ["Rotation", "Поворот", "Вращение"], index: 7 },
};

const C = (fx: Fx, param: Channel["param"], keys: Array<[number, number]>): Channel => ({ fx, param, keys });

export const HITS: Hit[] = [
  { id: "hit-flash", name: "Вспышка", desc: "Белая вспышка + лёгкий зум, 5 кадров", channels: [C("bc", "brightness", [[0, 0], [1, 80], [4, 0]]), C("tf", "scale", [[0, 100], [1, 108], [5, 100]])] },
  { id: "hit-punch", name: "Удар-зум", desc: "Резкий наезд и возврат, 8 кадров", channels: [C("tf", "scale", [[0, 100], [2, 118], [8, 100]])] },
  { id: "hit-blur-punch", name: "Блюр-удар", desc: "Размытие + зум на бит", channels: [C("blur", "blur", [[0, 0], [1, 40], [5, 0]]), C("tf", "scale", [[0, 100], [1, 110], [6, 100]])] },
  { id: "hit-blur-nudge", name: "Блюр-толчок", desc: "Короткое размытие, 3 кадра", channels: [C("blur", "blur", [[0, 0], [1, 22], [3, 0]])] },
  { id: "hit-flash-slam", name: "Вспышка-блюр", desc: "Яркая вспышка с размытием", channels: [C("bc", "brightness", [[0, 0], [1, 100], [3, 0]]), C("blur", "blur", [[0, 0], [1, 30], [4, 0]])] },
  { id: "hit-dark", name: "Провал", desc: "Затемнение на 4 кадра", channels: [C("bc", "brightness", [[0, 0], [1, -80], [4, 0]])] },
  { id: "hit-recoil", name: "Отдача", desc: "Сжатие и отскок, 7 кадров", channels: [C("tf", "scale", [[0, 100], [1, 92], [4, 103], [7, 100]])] },
  { id: "hit-twist", name: "Твист", desc: "Поворот туда-обратно с зумом", channels: [C("tf", "rotation", [[0, 0], [1, 4], [3, -2], [6, 0]]), C("tf", "scale", [[0, 100], [1, 106], [6, 100]])] },
];

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

async function lastComp(item: any, match: string): Promise<any | null> {
  const ch = await item.getComponentChain();
  for (let i = ch.getComponentCount() - 1; i >= 0; i--) if ((await ch.getComponentAtIndex(i).getMatchName()) === match) return ch.getComponentAtIndex(i);
  return null;
}

/** Применить удар к выделенным видеоклипам. */
/** times — моменты на таймлайне (например, биты); без них — от плейхеда. */
export async function applyHit(hitId: string, times?: number[]): Promise<string> {
  const hit = HITS.find((h) => h.id === hitId);
  if (!hit) throw new HostToolError(`Нет удара «${hitId}».`);
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const seq = await project?.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  const sel = await seq.getSelection();
  const items: any[] = ((await sel?.getTrackItems()) ?? []).filter((it: any) => typeof it.isAdjustmentLayer === "function");
  if (!items.length) throw new HostToolError("Выделите видеоклипы на таймлайне и поставьте плейхед на бит.");

  // Эффекты, которые нужны удару.
  const need = [...new Set(hit.channels.map((c) => c.fx))];
  const match: Partial<Record<Fx, string>> = {};
  for (const fx of need) {
    const m = await findEffect(FX[fx].names, FX[fx].match);
    if (!m) throw new HostToolError(`Не нашёл эффект ${FX[fx].label}.`);
    match[fx] = m;
  }
  const frame = await frameSeconds(seq);
  const play: number = (await seq.getPlayerPosition()).seconds;
  const T = (x: number) => p.TickTime.createWithSeconds(x);
  const BEZ = p.Constants?.InterpolationMode?.BEZIER;
  let done = 0;
  const missing = new Set<string>();

  for (const item of items) {
    // Добавить недостающие эффекты (Transform — один на клип, переиспользуется).
    for (const fx of need) {
      if (await lastComp(item, match[fx]!)) continue;
      const chain = await item.getComponentChain();
      const comp = await p.VideoFilterFactory.createComponent(match[fx]);
      run(project, `Ассистент: удар — ${FX[fx].label}`, (c) => c.addAction(chain.createAppendComponentAction(comp)));
    }
    const start = (await item.getStartTime()).seconds;
    const end = (await item.getEndTime()).seconds;
    const inS = (await item.getInPoint()).seconds;
    // Моменты удара в этом клипе → медиа-время клипа.
    const ats = times
      ? times.filter((t) => t >= start - 0.001 && t < end - frame)
      : [play >= start && play < end - frame ? play : start];
    if (!ats.length) continue;
    const t0s = ats.map((at) => inS + (at - start));

    const keys: Array<{ prm: any; t: number; v: number }> = [];
    const statics: Array<{ prm: any; v: number | boolean }> = [];
    for (const ch of hit.channels) {
      const comp = await lastComp(item, match[ch.fx]!);
      const prm = comp ? paramBy(comp, PARAM[ch.param].names, PARAM[ch.param].index) : null;
      if (!prm) {
        missing.add(`${FX[ch.fx].label} → ${PARAM[ch.param].names[0]}`);
        continue;
      }
      for (const t0 of t0s) for (const [f, v] of ch.keys) keys.push({ prm, t: t0 + f * frame, v });
      if (ch.fx === "tf" && comp) {
        // Моушн-блюр для Transform: «Use Composition's Shutter Angle» выкл., угол 180.
        const useComp = paramBy(comp, ["Use Composition's Shutter Angle", "Use Composition’s Shutter Angle", "Использовать угол затвора композиции"], 9);
        const shutter = paramBy(comp, ["Shutter Angle", "Угол затвора"], 10);
        if (useComp && !useComp.isTimeVarying?.()) statics.push({ prm: useComp, v: false });
        if (shutter && !shutter.isTimeVarying?.()) statics.push({ prm: shutter, v: 180 });
      }
      if (ch.fx === "blur" && comp) {
        const repeat = paramBy(comp, ["Repeat Edge Pixels", "Повторять краевые пиксели"], 2);
        if (repeat && !repeat.isTimeVarying?.()) statics.push({ prm: repeat, v: true });
      }
    }
    if (!keys.length) continue;
    if (statics.length) {
      try {
        run(project, "Ассистент: удар — настройки", (c) => {
          for (const s of statics) c.addAction(s.prm.createSetValueAction(s.prm.createKeyframe(s.v), true));
        });
      } catch {
        /* не критично */
      }
    }
    run(project, `Ассистент: ${hit.name}`, (c) => {
      for (const prm of new Set(keys.map((k) => k.prm))) if (!prm.isTimeVarying?.()) c.addAction(prm.createSetTimeVaryingAction(true));
      for (const k of keys) {
        const kf = k.prm.createKeyframe(k.v);
        kf.position = T(k.t);
        c.addAction(k.prm.createAddKeyframeAction(kf));
      }
    });
    if (typeof BEZ === "number") {
      try {
        run(project, `Ассистент: ${hit.name} — плавность`, (c) => {
          for (const k of keys) c.addAction(k.prm.createSetInterpolationAtKeyframeAction(T(k.t), BEZ, true));
        });
      } catch {
        /* не критично */
      }
    }
    done++;
  }
  if (!done) throw new HostToolError(`Не получилось: не нашёл параметры (${[...missing].join(", ")}).`);
  const miss = missing.size ? ` Не нашёл: ${[...missing].join(", ")}.` : "";
  if (times) return `«${hit.name}» на битах — ${done} клип. (биты вне клипов пропущены). Отмена — Ctrl+Z.${miss}`;
  return `«${hit.name}» — ${done} клип. от плейхеда. Повторите на следующем бите. Отмена — Ctrl+Z.${miss}`;
}
