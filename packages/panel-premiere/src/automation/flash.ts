import { HostToolError } from "../hostTools/types.ts";
import { findEffect, paramBy } from "../graphics/insert.ts";
import { frameSeconds } from "./graph.ts";
import { ppro } from "./timeline.ts";

/**
 * «Вспышка»: объект на пару кадров светится и возвращается к обычному виду.
 * bright — Brightness & Contrast → Brightness 0 → пик → 0; glow — Alpha Glow → Glow 0 → пик → 0 (для PNG/текста).
 * Момент — плейхед, если он внутри клипа, иначе начало клипа. Ключи: старт, пик через половину, конец через frames кадров.
 */
export type FlashKind = "bright" | "glow";

const SPEC: Record<FlashKind, { names: string[]; match: string[]; param: string[]; index: number; peak: number; label: string }> = {
  bright: {
    names: ["Brightness & Contrast", "Яркость и контрастность", "Яркость и контраст"],
    match: [],
    param: ["Brightness", "Яркость"],
    index: 0,
    peak: 70,
    label: "Brightness & Contrast",
  },
  glow: {
    names: ["Alpha Glow", "Альфа-свечение", "Свечение альфа-канала", "Свечение альфа"],
    match: [],
    param: ["Glow", "Свечение"],
    index: 0,
    peak: 30,
    label: "Alpha Glow",
  },
};

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

export async function flashSelected(kind: FlashKind, frames = 4): Promise<string> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const seq = await project?.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  const sel = await seq.getSelection();
  const all: any[] = (await sel?.getTrackItems()) ?? [];
  const items: any[] = [];
  for (const it of all) if (typeof it.getComponentChain === "function" && (await it.getComponentChain().then((c: any) => c.getComponentCount() >= 2).catch(() => false))) items.push(it);
  if (!items.length) throw new HostToolError("Выделите видеоклипы (или PNG/текст) на таймлайне.");
  const s = SPEC[kind];
  const match = await findEffect(s.names, s.match);
  if (!match) throw new HostToolError(`Не нашёл эффект ${s.label}.`);
  const frame = await frameSeconds(seq);
  const play: number = (await seq.getPlayerPosition()).seconds;
  const T = (x: number) => p.TickTime.createWithSeconds(x);
  let done = 0;
  for (const item of items) {
    const chain = await item.getComponentChain();
    let fx: any = null;
    for (let i = chain.getComponentCount() - 1; i >= 0 && !fx; i--) if ((await chain.getComponentAtIndex(i).getMatchName()) === match) fx = chain.getComponentAtIndex(i);
    if (!fx) {
      const comp = await p.VideoFilterFactory.createComponent(match);
      run(project, `Ассистент: вспышка — ${s.label}`, (c) => c.addAction(chain.createAppendComponentAction(comp)));
      const ch = await item.getComponentChain();
      for (let i = ch.getComponentCount() - 1; i >= 0 && !fx; i--) if ((await ch.getComponentAtIndex(i).getMatchName()) === match) fx = ch.getComponentAtIndex(i);
    }
    const prm = fx ? paramBy(fx, s.param, s.index) : null;
    if (!prm) continue;
    const start = (await item.getStartTime()).seconds;
    const end = (await item.getEndTime()).seconds;
    const inS = (await item.getInPoint()).seconds;
    const at = play >= start && play < end - frame ? play : start;
    const t0 = inS + (at - start);
    const half = Math.max(1, Math.round(frames / 2)) * frame;
    run(project, "Ассистент: вспышка", (c) => {
      c.addAction(prm.createSetTimeVaryingAction(true));
      for (const [t, v] of [
        [t0, 0],
        [t0 + half, s.peak],
        [t0 + Math.max(2, frames) * frame, 0],
      ] as const) {
        const k = prm.createKeyframe(v);
        k.position = T(t);
        c.addAction(prm.createAddKeyframeAction(k));
      }
    });
    done++;
  }
  if (!done) throw new HostToolError(`Не нашёл параметр ${s.param[0]} у эффекта ${s.label}.`);
  return `Вспышка на ${frames} кадр. у ${done} клип. (${s.label}) — от плейхеда, если он на клипе, иначе с начала. Сила — ключ посередине. Отмена — Ctrl+Z.`;
}
