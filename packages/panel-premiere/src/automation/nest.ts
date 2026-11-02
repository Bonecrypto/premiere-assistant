import { HostToolError } from "../hostTools/types.ts";
import { ppro } from "./timeline.ts";

/**
 * Быстрый Nest и «разобрать» (Unnest) — своими силами: команды Nest в UXP API нет.
 * Nest: in/out секвенции = диапазон выделенных → Sequence.createSubsequence (клипы копируются с эффектами) →
 *   в новой секвенции убираем то, что не было выделено → в основной удаляем выделенное и ставим вложенную
 *   секвенцию на самую нижнюю из выделенных дорожек.
 * Unnest: клипы вложенной секвенции заново кладутся из исходных файлов (ClipProjectItem in/out + createOverwriteItemAction).
 *   Эффекты внутренних клипов при этом НЕ переносятся — API копировать клипы между секвенциями не умеет.
 */

const EPS = 0.002;

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

interface Placed {
  item: any;
  kind: "v" | "a";
  track: number;
  start: number;
  end: number;
  inPt: number;
  name: string;
}

async function itemsOf(seq: any, onlySelected: boolean): Promise<Placed[]> {
  const p = ppro() as any;
  const CLIP = p.Constants?.TrackItemType?.CLIP ?? 1;
  const out: Placed[] = [];
  for (const kind of ["v", "a"] as const) {
    const n: number = kind === "v" ? await seq.getVideoTrackCount() : await seq.getAudioTrackCount();
    for (let i = 0; i < n; i++) {
      const track = kind === "v" ? await seq.getVideoTrack(i) : await seq.getAudioTrack(i);
      for (const it of (await track?.getTrackItems(CLIP, false)) ?? []) {
        if (onlySelected && !(await it.getIsSelected().catch(() => false))) continue;
        out.push({
          item: it,
          kind,
          track: i,
          start: (await it.getStartTime()).seconds,
          end: (await it.getEndTime()).seconds,
          inPt: (await it.getInPoint()).seconds,
          name: String((await it.getName().catch(() => "")) ?? ""),
        });
      }
    }
  }
  return out;
}

function withSelection(p: any, items: any[], fn: (sel: any) => void): void {
  let done = false;
  p.TrackItemSelection.createEmptySelection((sel: any) => {
    for (const it of items) sel.addItem(it, true);
    fn(sel);
    done = true;
  });
  if (!done) throw new HostToolError("Premiere не дал собрать выделение.");
}

export async function nestSelected(name?: string): Promise<string> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const seq = await project?.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  const sel = await itemsOf(seq, true);
  if (!sel.length) throw new HostToolError("Выделите клипы на таймлайне.");
  const a = Math.min(...sel.map((s) => s.start));
  const b = Math.max(...sel.map((s) => s.end));
  const T = (s: number) => p.TickTime.createWithSeconds(s);

  // 1. Подсеквенция по диапазону выделенных.
  const oldIn = (await seq.getInPoint()).seconds;
  const oldOut = (await seq.getOutPoint()).seconds;
  run(project, "Ассистент: Nest — диапазон", (c) => {
    c.addAction(seq.createSetInPointAction(T(a)));
    c.addAction(seq.createSetOutPointAction(T(b)));
  });
  let sub: any;
  try {
    sub = await seq.createSubsequence(true);
  } finally {
    try {
      run(project, "Ассистент: Nest — вернуть in/out", (c) => {
        c.addAction(seq.createSetInPointAction(T(oldIn)));
        c.addAction(seq.createSetOutPointAction(T(oldOut)));
      });
    } catch {
      /* не критично */
    }
  }
  if (!sub) throw new HostToolError("Premiere не создал вложенную секвенцию.");

  // 2. В подсеквенции оставить только выделенное (сравниваем дорожку, тип, имя и время от начала диапазона).
  const inner = await itemsOf(sub, false);
  const zero = inner.length ? Math.min(...inner.map((i) => i.start)) : 0;
  const keep = (i: Placed) =>
    sel.some(
      (s) =>
        s.kind === i.kind &&
        s.track === i.track &&
        s.name === i.name &&
        Math.abs(Math.max(s.start, a) - a - (i.start - zero)) < 0.05 &&
        Math.abs(Math.min(s.end, b) - a - (i.end - zero)) < 0.05,
    );
  const extra = inner.filter((i) => !keep(i)).map((i) => i.item);
  if (extra.length) {
    const subEditor = p.SequenceEditor.getEditor(sub);
    withSelection(p, extra, (s) => run(project, "Ассистент: Nest — лишнее", (c) => c.addAction(subEditor.createRemoveItemsAction(s, false, p.Constants.MediaType.ANY))));
  }
  const subItem = await sub.getProjectItem();
  if (name) {
    try {
      run(project, "Ассистент: Nest — имя", (c) => c.addAction(subItem.createSetNameAction(name)));
    } catch {
      /* имя по умолчанию */
    }
  }

  // 3. В основной: убрать выделенное и поставить вложенную секвенцию.
  const editor = p.SequenceEditor.getEditor(seq);
  withSelection(p, sel.map((s) => s.item), (s) => run(project, "Ассистент: Nest — убрать клипы", (c) => c.addAction(editor.createRemoveItemsAction(s, false, p.Constants.MediaType.ANY))));
  const vIdx = sel.some((s) => s.kind === "v") ? Math.min(...sel.filter((s) => s.kind === "v").map((s) => s.track)) : 0;
  const aIdx = sel.some((s) => s.kind === "a") ? Math.min(...sel.filter((s) => s.kind === "a").map((s) => s.track)) : 0;
  run(project, "Ассистент: Nest", (c) => c.addAction(editor.createOverwriteItemAction(subItem, T(a), vIdx, aIdx)));
  const subName = String((await subItem.getName?.().catch(() => "")) ?? "");
  return `Готово: ${sel.length} клип. → вложенная секвенция «${subName || "Nested"}» (V${vIdx + 1}). Разобрать обратно — «Разобрать Nest». Отмена — Ctrl+Z несколько раз.`;
}

export async function unnestSelected(): Promise<string> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const seq = await project?.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  const sel = await itemsOf(seq, true);
  // Найти выделенный вложенный клип.
  let nestV: Placed | null = null;
  let nested: any = null;
  for (const s of sel) {
    const pi = await s.item.getProjectItem();
    const cp = p.ClipProjectItem.cast(pi);
    if (cp && (await cp.isSequence().catch(() => false))) {
      nested = await cp.getSequence();
      if (!nestV || s.kind === "v") nestV = s;
      if (s.kind === "v") break;
    }
  }
  if (!nestV || !nested) throw new HostToolError("Выделите вложенную секвенцию (Nest) на таймлайне.");
  const nestA = sel.find((s) => s.kind === "a" && Math.abs(s.start - nestV!.start) < EPS) ?? null;
  const vBase = nestV.kind === "v" ? nestV.track : 0;
  const aBase = nestA ? nestA.track : nestV.kind === "a" ? nestV.track : 0;
  const from = nestV.inPt;
  const to = nestV.inPt + (nestV.end - nestV.start);
  const shift = nestV.start - from;

  const inner = (await itemsOf(nested, false)).filter((i) => i.end > from + EPS && i.start < to - EPS);
  if (!inner.length) throw new HostToolError("Вложенная секвенция пустая в этом диапазоне.");

  // 1. Убрать вложенный клип (видео и звук).
  const editor = p.SequenceEditor.getEditor(seq);
  const remove = [nestV.item, ...(nestA ? [nestA.item] : [])];
  withSelection(p, remove, (s) => run(project, "Ассистент: разобрать Nest — убрать", (c) => c.addAction(editor.createRemoveItemsAction(s, false, p.Constants.MediaType.ANY))));

  // 2. Положить клипы из исходных файлов на те же места.
  const T = (s: number) => p.TickTime.createWithSeconds(s);
  let placed = 0;
  const skipped: string[] = [];
  for (const i of inner) {
    const pi = p.ClipProjectItem.cast(await i.item.getProjectItem());
    if (!pi) {
      skipped.push(i.name);
      continue;
    }
    const cutIn = Math.max(0, from - i.start);
    const cutOut = Math.max(0, i.end - to);
    const srcIn = i.inPt + cutIn;
    const srcOut = i.inPt + (i.end - i.start) - cutOut;
    const at = Math.max(i.start, from) + shift;
    try {
      run(project, "Ассистент: разобрать Nest", (c) => {
        c.addAction(pi.createSetInOutPointsAction(T(srcIn), T(srcOut)));
        c.addAction(editor.createOverwriteItemAction(pi, T(at), i.kind === "v" ? vBase + i.track : -1, i.kind === "a" ? aBase + i.track : -1));
        c.addAction(pi.createClearInOutPointsAction());
      });
      placed++;
    } catch {
      skipped.push(i.name);
    }
  }
  const sk = skipped.length ? ` Не получилось: ${skipped.slice(0, 3).join(", ")}.` : "";
  return `Разобрано: ${placed} клип. на V${vBase + 1}+ / A${aBase + 1}+. Эффекты внутренних клипов не переносятся (ограничение API) — вложенная секвенция осталась в проекте.${sk}`;
}
