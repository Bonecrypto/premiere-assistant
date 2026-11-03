import { HostToolError } from "../hostTools/types.ts";
import { animateSelected } from "../automation/animate.ts";
import { dataFileItem, place } from "../automation/quickCreate.ts";
import { ppro } from "../automation/timeline.ts";
import { loadAnimOptions } from "../presets/animations.ts";
import { LIBRARY } from "../presets/library.ts";
import { GRAPHICS, graphicPng, type Dir, type Reveal } from "./elements.ts";

/**
 * Вставка графического элемента: PNG нужного цвета/направления (папка данных `graphics/`) → импорт →
 * под плейхед на свободную видеодорожку над V1 → длительность → анимация появления.
 * Прорисовка: Linear Wipe (стрелки, линии) или Radial Wipe (обвести) — ключи Transition Completion 100 → 0.
 */

export type Anim = "draw" | "pop" | "fade" | "none";

export interface InsertOptions {
  color: string;
  dir: Dir;
  anim: Anim;
  seconds: number;
  /** Длительность появления, с. */
  inSeconds?: number;
}

// Угол Linear Wipe, при котором 100 → 0 открывает элемент по направлению стрелки (как в AE: 90° — шторка слева направо). Проверить.
const WIPE_ANGLE: Record<Dir, number> = { right: 270, left: 90, down: 0, up: 180 };

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

export async function findEffect(names: string[], match: string[]): Promise<string | null> {
  const f = (ppro() as any).VideoFilterFactory;
  const matchNames: string[] = (await f.getMatchNames()) ?? [];
  for (const m of match) if (matchNames.includes(m)) return m;
  let display: string[] = [];
  try {
    display = (await f.getDisplayNames()) ?? [];
  } catch {
    /* нет видимых названий */
  }
  const low = names.map((n) => n.toLowerCase());
  const i = display.findIndex((d) => low.includes(String(d).trim().toLowerCase()));
  return i >= 0 && display.length === matchNames.length ? matchNames[i] : null;
}

export function paramBy(comp: any, names: string[], index: number): any | null {
  const n: number = comp.getParamCount();
  const list: any[] = [];
  for (let i = 0; i < n; i++) list.push(comp.getParam(i));
  const low = names.map((x) => x.toLowerCase());
  return list.find((p) => low.includes(String(p.displayName ?? "").trim().toLowerCase())) ?? list[index] ?? null;
}

/** Прорисовка шторкой: эффект + ключи Transition Completion 100 → 0. */
async function drawOn(item: any, radial: boolean, dir: Dir, dur: number): Promise<void> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const match = radial
    ? await findEffect(["Radial Wipe", "Радиальное стирание", "Радиальная шторка", "Радиальная очистка"], ["AE.ADBE Radial Wipe"])
    : await findEffect(["Linear Wipe", "Линейное стирание", "Линейная шторка", "Линейная очистка"], ["AE.ADBE Linear Wipe"]);
  if (!match) throw new HostToolError(`Не нашёл эффект ${radial ? "Radial Wipe" : "Linear Wipe"} — элемент вставлен без прорисовки.`);
  const chain = await item.getComponentChain();
  const comp = await p.VideoFilterFactory.createComponent(match);
  run(project, "Ассистент: прорисовка — эффект", (c) => c.addAction(chain.createAppendComponentAction(comp)));
  // Найти добавленный (последний с таким matchName).
  const ch = await item.getComponentChain();
  let fx: any = null;
  for (let i = ch.getComponentCount() - 1; i >= 0; i--) {
    const cmp = ch.getComponentAtIndex(i);
    if ((await cmp.getMatchName()) === match) {
      fx = cmp;
      break;
    }
  }
  if (!fx) throw new HostToolError("Эффект прорисовки не добавился.");
  const completion = paramBy(fx, ["Transition Completion", "Завершение перехода", "Завершение"], 0);
  const angle = radial ? null : paramBy(fx, ["Wipe Angle", "Угол стирания", "Угол шторки", "Угол"], 1);
  const feather = paramBy(fx, ["Feather", "Растушевка", "Растушёвка"], radial ? 4 : 2);
  if (!completion) throw new HostToolError("Не нашёл параметр Transition Completion.");
  const inS: number = (await item.getInPoint()).seconds;
  const T = (s: number) => p.TickTime.createWithSeconds(s);
  run(project, "Ассистент: прорисовка — настройки", (c) => {
    if (angle) c.addAction(angle.createSetValueAction(angle.createKeyframe(WIPE_ANGLE[dir]), true));
    if (feather) c.addAction(feather.createSetValueAction(feather.createKeyframe(radial ? 0 : 12), true));
    c.addAction(completion.createSetTimeVaryingAction(true));
  });
  run(project, "Ассистент: прорисовка", (c) => {
    const k0 = completion.createKeyframe(100);
    k0.position = T(inS);
    const k1 = completion.createKeyframe(0);
    k1.position = T(inS + dur);
    c.addAction(completion.createAddKeyframeAction(k0));
    c.addAction(completion.createAddKeyframeAction(k1));
  });
  const BEZ = p.Constants?.InterpolationMode?.BEZIER;
  if (typeof BEZ === "number") {
    try {
      run(project, "Ассистент: прорисовка — плавность", (c) => {
        c.addAction(completion.createSetInterpolationAtKeyframeAction(T(inS), BEZ, true));
        c.addAction(completion.createSetInterpolationAtKeyframeAction(T(inS + dur), BEZ, true));
      });
    } catch {
      /* не критично */
    }
  }
}

export function selectOnly(seq: any, item: any): void {
  const p = ppro() as any;
  p.TrackItemSelection.createEmptySelection((sel: any) => {
    sel.addItem(item, true);
    seq.setSelection(sel);
  });
}

export async function insertGraphic(id: string, opt: InsertOptions): Promise<string> {
  const def = GRAPHICS.find((g) => g.id === id);
  if (!def) throw new HostToolError(`Нет элемента «${id}».`);
  const dir: Dir = def.rotates ? opt.dir : "right";
  const hex = opt.color.replace("#", "").toLowerCase();
  const file = def.neon ? `${id}.png` : `${id}-${dir}-${hex}.png`;
  const item = await dataFileItem("graphics", file, () => graphicPng(id, hex, dir), false);
  const r = await place(item, `Ассистент: ${def.name}`, { useSelection: false, seconds: opt.seconds });
  const where = `V${r.track + 1}, ${r.start.toFixed(2)} с`;
  if (opt.anim === "none" || !r.item) return `«${def.name}» — на ${where}. Отмена — Ctrl+Z.`;
  const dur = Math.max(0.1, opt.inSeconds ?? 0.5);
  const reveal: Reveal = def.reveal;
  try {
    if (opt.anim === "draw" && reveal !== "pop") {
      await drawOn(r.item, reveal === "radial", dir, dur);
    } else {
      const p = ppro() as any;
      const seq = await (await p.Project.getActiveProject()).getActiveSequence();
      selectOnly(seq, r.item);
      const preset = LIBRARY.find((a) => a.id === (opt.anim === "fade" ? "lib-soft-in" : "lib-pop-in"));
      if (preset) await animateSelected(preset, loadAnimOptions());
    }
  } catch (err) {
    return `«${def.name}» — на ${where}, но анимация не добавилась: ${(err as Error)?.message ?? err}`;
  }
  return `«${def.name}» — на ${where} с анимацией. Размер и место — в Effect Controls → Motion. Отмена — Ctrl+Z.`;
}
