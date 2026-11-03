import { HostToolError } from "../hostTools/types.ts";
import { openKeysClient } from "./keysClient.ts";
import { decideShots, type Shot } from "./shots.ts";
import { ppro } from "./timeline.ts";

/**
 * Переключение камер (подкаст): выделены клипы камер (V1, V2…) и микрофонов (A1, A2…), лежащие синхронно.
 * Микрофоны по порядку дорожек ↔ камеры по порядку дорожек; лишняя камера (самая нижняя) — общий план.
 * Программа в трее (v13) меряет громкость микрофонов → decideShots → камеры режутся в точках переключения
 * (копия → обрезка → на место, эффекты сохраняются), неактивные куски выключаются (createSetDisabledAction) —
 * ничего не удаляется, любой кусок можно включить обратно (Shift+E).
 */

export interface CamPlan {
  key: string;
  start: number;
  end: number;
  shots: Shot[];
  /** Подпись: какой микрофон — какая камера. */
  mapping: string;
  wide: number | null;
}

const AI_MIN_VERSION = 13;
const H = { "Content-Type": "application/json", "X-Premiere-Assistant": "1" };
const EPS = 0.02;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const r: Response = await fetch(url, init);
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok && !j?.error) j.error = `ответ ${r.status}`;
  return j;
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

interface Sel {
  item: any;
  video: boolean;
  track: number;
  start: number;
  end: number;
}

async function selection() {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const seq = await project?.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  const raw: any[] = (await (await seq.getSelection())?.getTrackItems()) ?? [];
  const items: Sel[] = [];
  for (const it of raw) {
    items.push({
      item: it,
      video: typeof it.isAdjustmentLayer === "function" && typeof it.createAddVideoTransitionAction === "function",
      track: await it.getTrackIndex(),
      start: (await it.getStartTime()).seconds,
      end: (await it.getEndTime()).seconds,
    });
  }
  return { p, project, seq, items };
}

const keyOf = (items: Sel[]) => items.map((s) => `${s.video ? "V" : "A"}${s.track}@${s.start.toFixed(2)}`).join(",");

export async function analyzeCameras(minShot: number, report: (t: string) => void = () => {}): Promise<CamPlan> {
  const { p, items } = await selection();
  const cams = items.filter((s) => s.video).sort((a, b) => a.track - b.track);
  const mics = items.filter((s) => !s.video).sort((a, b) => a.track - b.track);
  if (cams.length < 2 || mics.length < 1) throw new HostToolError("Выделите клипы камер (V1, V2…) и их микрофоны (A1, A2…) — минимум 2 камеры и 1 микрофон.");
  const extra = cams.length - mics.length;
  if (extra < 0 || extra > 1) throw new HostToolError(`Камер ${cams.length}, микрофонов ${mics.length}: нужно поровну (или на одну камеру больше — она станет общим планом).`);
  const wideCam = extra === 1 ? 0 : null; // самая нижняя камера — общий план
  const camForMic = mics.map((_, i) => i + (extra === 1 ? 1 : 0));
  const start = Math.max(...items.map((s) => s.start));
  const end = Math.min(...items.map((s) => s.end));
  if (end - start < 2) throw new HostToolError("Камеры и микрофоны должны лежать синхронно и перекрываться хотя бы на 2 с.");

  const inputs = [];
  for (const m of mics) {
    const pi = p.ClipProjectItem.cast(await m.item.getProjectItem());
    const src: string = String((await pi?.getMediaFilePath?.().catch(() => "")) ?? "");
    if (!src) throw new HostToolError(`У микрофона на A${m.track + 1} нет файла.`);
    const inPt = (await m.item.getInPoint()).seconds;
    inputs.push({ in: src, ss: inPt + (start - m.start), dur: end - start });
  }

  report("Запускаю программу в трее…");
  let client;
  try {
    client = await openKeysClient(AI_MIN_VERSION);
  } catch {
    throw new HostToolError("Не запустилась программа в трее — нажмите ещё раз.");
  }
  client.close();
  const base = client.base!;
  const st = await getJson(`${base}/ai/status`);
  if (!st.ffmpeg) {
    const s = await getJson(`${base}/ai/setup?ffmpeg=1`, { method: "POST", headers: H, body: "{}" });
    if (!s.ok) throw new HostToolError(`Не начал загрузку ffmpeg: ${s.error}`);
    for (;;) {
      await sleep(700);
      const q = await getJson(`${base}/ai/status`);
      if (q.ffmpeg) break;
      if (q.error) throw new HostToolError(`Не скачался ffmpeg: ${q.error}`);
      report(`Скачиваю ffmpeg (~90 МБ, один раз)… ${q.total ? Math.round((q.done / q.total) * 100) : 0}%`);
    }
  }
  report("Слушаю микрофоны…");
  const job = await getJson(`${base}/levels`, { method: "POST", headers: H, body: JSON.stringify({ inputs, win: 0.1 }) });
  if (!job.ok) throw new HostToolError(`Не получилось: ${job.error}`);
  let levels: number[][] = [];
  for (;;) {
    await sleep(400);
    const j = await getJson(`${base}/job/${job.job}`);
    if (j.state === "error" || j.ok === false) throw new HostToolError(`Не получилось измерить звук: ${j.error}`);
    if (j.state === "done") {
      levels = j.result?.levels ?? [];
      break;
    }
    report(`Слушаю микрофоны… ${Math.round((j.progress || 0) * 100)}%`);
  }
  const shots = decideShots(levels, { win: 0.1, camForMic, wide: wideCam, minShot }).map((s) => ({ ...s, start: s.start + start, end: Math.min(end, s.end + start) }));
  const mapping =
    mics.map((m, i) => `A${m.track + 1} → V${cams[camForMic[i]].track + 1}`).join(", ") + (wideCam !== null ? `, общий план — V${cams[0].track + 1}` : "");
  return { key: keyOf(items), start, end, shots, mapping, wide: wideCam };
}

async function clipsOn(p: any, seq: any, track: number): Promise<any[]> {
  const CLIP = p.Constants?.TrackItemType?.CLIP ?? 1;
  return (await (await seq.getVideoTrack(track))?.getTrackItems(CLIP, false)) ?? [];
}

async function findAt(p: any, seq: any, track: number, start: number): Promise<any | null> {
  for (const it of await clipsOn(p, seq, track)) if (Math.abs((await it.getStartTime()).seconds - start) < EPS) return it;
  return null;
}

export async function applyCameras(plan: CamPlan, report: (t: string) => void = () => {}): Promise<string> {
  const { p, project, seq, items } = await selection();
  if (keyOf(items) !== plan.key) throw new HostToolError("Выделение изменилось — нажмите «Найти» заново.");
  const cams = items.filter((s) => s.video).sort((a, b) => a.track - b.track);
  const editor = p.SequenceEditor.getEditor(seq);
  const T = (x: number) => p.TickTime.createWithSeconds(x);
  const seqEnd = (await seq.getEndTime()).seconds;
  const cuts = plan.shots.slice(1).map((s) => s.start);
  let disabled = 0;

  for (let ci = 0; ci < cams.length; ci++) {
    const c = cams[ci];
    // Куски этой камеры: границы — её края и все точки переключения внутри.
    const bounds = [c.start, ...cuts.filter((t) => t > c.start + EPS && t < c.end - EPS), c.end];
    const pieces: Array<[number, number]> = bounds.slice(0, -1).map((a, i) => [a, bounds[i + 1]]);
    report(`Камера V${c.track + 1}: ${pieces.length} кусков…`);
    const span = c.end - c.start + 1;
    const off = (k: number) => seqEnd + 10 + ci * 1000 + (k - 1) * span - c.start;
    if (pieces.length > 1) {
      // 1. Копии для кусков 2…n во временное место справа.
      const need: number[] = [];
      for (let k = 1; k < pieces.length; k++) if (!(await findAt(p, seq, c.track, c.start + off(k)))) need.push(k);
      if (need.length) run(project, "Ассистент: камеры — копии", (cx) => need.forEach((k) => cx.addAction(editor.createCloneTrackItemAction(c.item, T(off(k)), 0, 0, false, false))));
      // 2. Обрезка: исходник — первый кусок, копия k — кусок k.
      const acts: Array<() => any> = [];
      const orig = await findAt(p, seq, c.track, c.start);
      if (orig && (await orig.getEndTime()).seconds - pieces[0][1] > EPS) acts.push(() => orig.createSetEndAction(T(pieces[0][1])));
      for (let k = 1; k < pieces.length; k++) {
        const [a, b] = pieces[k];
        const cl = (await findAt(p, seq, c.track, c.start + off(k))) ?? (await findAt(p, seq, c.track, a + off(k)));
        if (!cl) continue;
        if ((await cl.getEndTime()).seconds - (b + off(k)) > EPS) acts.push(() => cl.createSetEndAction(T(b + off(k))));
        if (a + off(k) - (await cl.getStartTime()).seconds > EPS) acts.push(() => cl.createSetStartAction(T(a + off(k))));
      }
      if (acts.length) run(project, "Ассистент: камеры — обрезка", (cx) => acts.forEach((f) => cx.addAction(f())));
      // 3. На место (обратно в своё время).
      const moves: Array<{ it: any; d: number }> = [];
      for (let k = 1; k < pieces.length; k++) {
        const cl = await findAt(p, seq, c.track, pieces[k][0] + off(k));
        if (cl) moves.push({ it: cl, d: -off(k) });
      }
      if (moves.length) run(project, "Ассистент: камеры — на место", (cx) => moves.forEach((m) => cx.addAction(m.it.createMoveAction(T(m.d)))));
    }
    // 4. Выключить куски, где эта камера не в кадре; включить — где в кадре.
    const toggles: Array<{ it: any; off: boolean }> = [];
    for (const [a, b] of pieces) {
      const it = await findAt(p, seq, c.track, a);
      if (!it) continue;
      const mid = (a + b) / 2;
      const shot = plan.shots.find((s) => mid >= s.start && mid < s.end);
      const visible = !shot || shot.cam === ci;
      const isOff = !!(await it.isDisabled?.().catch(() => false));
      if (isOff !== !visible) toggles.push({ it, off: !visible });
      if (!visible) disabled++;
    }
    if (toggles.length) run(project, "Ассистент: камеры — выключить лишнее", (cx) => toggles.forEach((t) => cx.addAction(t.it.createSetDisabledAction(t.off))));
  }

  // Подчистить, если связанный звук скопировался во временное место.
  const leftovers: any[] = [];
  const CLIP = p.Constants?.TrackItemType?.CLIP ?? 1;
  const na: number = await seq.getAudioTrackCount();
  for (let i = 0; i < na; i++) {
    for (const it of (await (await seq.getAudioTrack(i))?.getTrackItems(CLIP, false)) ?? []) if ((await it.getStartTime()).seconds > seqEnd + 5) leftovers.push(it);
  }
  if (leftovers.length) {
    try {
      p.TrackItemSelection.createEmptySelection((sel: any) => {
        leftovers.forEach((it) => sel.addItem(it, true));
        run(project, "Ассистент: камеры — уборка", (cx) => cx.addAction(editor.createRemoveItemsAction(sel, false, p.Constants.MediaType.ANY)));
      });
    } catch {
      /* не критично */
    }
  }
  return `Готово: ${plan.shots.length} планов, выключено кусков: ${disabled}. Ничего не удалено — любой кусок включается обратно (Shift+E). Отмена — Ctrl+Z несколько раз.`;
}
