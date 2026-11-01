import { HostToolError } from "../hostTools/types.ts";
import { ppro } from "./timeline.ts";

/**
 * Переходы на стыки выделенных клипов (Premiere UXP API 25.6+):
 * TransitionFactory.createVideoTransition + AddTransitionOptions + VideoClipTrackItem.createAddVideoTransitionAction.
 * Стык — конец клипа совпадает с началом следующего на той же дорожке. Одна транзакция (один Ctrl+Z).
 */

export type TransitionKind = "dissolve" | "black" | "white" | "film";

const PATTERNS: Record<TransitionKind, RegExp[]> = {
  dissolve: [/cross\s*dissolve/i, /crossdissolve/i],
  black: [/dip\s*to\s*black/i, /diptoblack/i],
  white: [/dip\s*to\s*white/i, /diptowhite/i],
  film: [/film\s*dissolve/i, /filmdissolve/i],
};

export const TRANSITION_TITLE: Record<TransitionKind, string> = {
  dissolve: "Растворение",
  black: "Через чёрный",
  white: "Через белый",
  film: "Плёночное растворение",
};

export interface TransitionRequest {
  kind: TransitionKind;
  seconds: number;
  /** Также в начале первого и в конце последнего клипа (из чёрного / в чёрный). */
  edges: boolean;
}

async function findMatchName(kind: TransitionKind): Promise<string> {
  const names: string[] = await (ppro() as any).TransitionFactory.getVideoTransitionMatchNames();
  for (const re of PATTERNS[kind]) {
    const n = names.find((x) => re.test(x));
    if (n) return n;
  }
  throw new HostToolError(`В этой версии Premiere не нашёл переход «${TRANSITION_TITLE[kind]}».`);
}

export async function addTransitions(req: TransitionRequest): Promise<{ added: number }> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new HostToolError("Нет активной секвенции.");
  const sel = await sequence.getSelection();
  const items: any[] = ((await sel?.getTrackItems()) ?? []).filter((it: any) => typeof it?.createAddVideoTransitionAction === "function");
  if (items.length === 0) throw new HostToolError("Выделите видеоклипы на таймлайне (можно все — Ctrl+A).");

  // Группируем по дорожкам и сортируем по времени, чтобы найти стыки.
  const info = await Promise.all(
    items.map(async (it) => ({
      it,
      track: await it.getTrackIndex(),
      start: (await it.getStartTime()).seconds as number,
      end: (await it.getEndTime()).seconds as number,
    })),
  );
  const byTrack = new Map<number, typeof info>();
  for (const x of info) byTrack.set(x.track, [...(byTrack.get(x.track) ?? []), x]);

  const plan: Array<{ it: any; atStart: boolean }> = [];
  const eps = 0.02;
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.start - b.start);
    list.forEach((x, i) => {
      const next = list[i + 1];
      if (next && Math.abs(next.start - x.end) < eps) plan.push({ it: x.it, atStart: false });
      if (req.edges && i === 0) plan.push({ it: x.it, atStart: true });
      if (req.edges && i === list.length - 1) plan.push({ it: x.it, atStart: false });
    });
  }
  if (plan.length === 0) throw new HostToolError("Среди выделенных клипов нет стыков (клипы должны стоять вплотную).");

  const matchName = await findMatchName(req.kind);
  const prepared = await Promise.all(
    plan.map(async (x) => {
      const transition = await p.TransitionFactory.createVideoTransition(matchName);
      const opt = p.AddTransitionOptions();
      opt.setApplyToStart(x.atStart);
      opt.setDuration(p.TickTime.createWithSeconds(req.seconds));
      return { it: x.it, transition, opt };
    }),
  );

  let ok = false;
  let error: unknown = null;
  project.lockedAccess(() => {
    try {
      ok = project.executeTransaction((c: any) => {
        for (const x of prepared) c.addAction(x.it.createAddVideoTransitionAction(x.transition, x.opt));
      }, `Ассистент: переходы «${TRANSITION_TITLE[req.kind]}»`);
    } catch (err) {
      error = err;
    }
  });
  if (error) throw new HostToolError(`Premiere не дал добавить переходы: ${(error as Error)?.message ?? error}`);
  if (!ok) throw new HostToolError("Premiere отклонил добавление переходов.");
  return { added: prepared.length };
}
