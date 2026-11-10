import { helperDownMessage } from "./keysLauncher.ts";
import { HostToolError } from "../hostTools/types.ts";
import { openKeysClient } from "./keysClient.ts";
import { ppro } from "./timeline.ts";

/**
 * «Вырезать паузы» (выделенный клип с речью — видео со звуком или только звук).
 * 1. Программа в трее (v10) ищет тишину: ffmpeg silencedetect по куску клипа на таймлайне.
 * 2. Панель режет БЕЗ потери эффектов: копии клипа (createCloneTrackItemAction) в свободное место справа →
 *    обрезка каждой копии по куску речи (createSetStart/EndAction — время на таймлайне) → куски вплотную на место
 *    исходника (createMoveAction) → клипы правее на тех же дорожках сдвигаются влево.
 * Видео и звук — по очереди, каждое действие сначала проверяет, где клип уже стоит (связанные клипы
 * Premiere может двигать вместе — двойного сдвига не будет). Отмена — несколько Ctrl+Z.
 */

export interface PauseOptions {
  /** Порог тишины, дБ. */
  noise: number;
  /** Минимальная пауза, с. */
  min: number;
  /** Запас вокруг речи, с. */
  pad: number;
}

export interface PausePlan {
  key: string;
  start: number;
  end: number;
  /** Куски, которые остаются (время на таймлайне). */
  keep: Array<[number, number]>;
  pauses: number;
  removed: number;
}

const AI_MIN_VERSION = 12;
const H = { "Content-Type": "application/json", "X-Premiere-Assistant": "1" };
const EPS = 0.02;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const r: Response = await fetch(url, init);
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok && !j?.error) j.error = `ответ ${r.status}`;
  return j;
}

interface Sel {
  item: any;
  video: boolean;
  track: number;
  start: number;
  end: number;
}

async function selection(): Promise<{ p: any; project: any; seq: any; items: Sel[] }> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const seq = await project?.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  const sel = await seq.getSelection();
  const raw: any[] = (await sel?.getTrackItems()) ?? [];
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

/** Найти паузы в выделенном клипе. */
export async function findPauses(opt: PauseOptions, report: (t: string) => void = () => {}): Promise<PausePlan> {
  const { p, items } = await selection();
  if (!items.length) throw new HostToolError("Выделите на таймлайне клип с речью (видео со звуком или звук).");
  const ref = items.find((s) => !s.video) ?? items[0];
  const pi = p.ClipProjectItem.cast(await ref.item.getProjectItem());
  const src: string = String((await pi?.getMediaFilePath?.().catch(() => "")) ?? "");
  if (!src) throw new HostToolError("У клипа нет файла — паузы ищутся в записи с голосом.");
  const speed = Number(await ref.item.getSpeed?.().catch(() => 1)) || 1;
  if (Math.abs(speed - 1) > 0.01) throw new HostToolError("У клипа изменена скорость — верните 100% или сделайте Nest.");
  const ss = (await ref.item.getInPoint()).seconds;
  const dur = ref.end - ref.start;

  report("Запускаю программу в трее…");
  let client;
  try {
    client = await openKeysClient(AI_MIN_VERSION);
  } catch {
    throw new HostToolError(helperDownMessage("Не запустилась программа в трее — нажмите ещё раз."));
  }
  client.close();
  const base = client.base!;
  // ffmpeg: скачать, если нет (с тем же согласием, что и для видео в «Убрать фон»).
  const st = await getJson(`${base}/ai/status`);
  if (!st.ffmpeg) {
    {
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
  }
  report("Ищу паузы…");
  const start = await getJson(`${base}/silence`, { method: "POST", headers: H, body: JSON.stringify({ in: src, ss, dur, noise: opt.noise, min: opt.min }) });
  if (!start.ok) throw new HostToolError(`Не получилось: ${start.error}`);
  let silences: Array<{ start: number; end: number }> = [];
  for (;;) {
    await sleep(400);
    const j = await getJson(`${base}/job/${start.job}`);
    if (j.state === "error" || j.ok === false) throw new HostToolError(`Не получилось найти паузы: ${j.error}`);
    if (j.state === "done") {
      silences = j.result ?? [];
      break;
    }
    report(`Ищу паузы… ${Math.round((j.progress || 0) * 100)}%`);
  }

  // Паузы → время на таймлайне, с запасом вокруг речи.
  const S = ref.start;
  const E = ref.end;
  const cuts: Array<[number, number]> = [];
  for (const s of silences) {
    let a = S + s.start;
    let b = S + s.end;
    if (s.start > 0.01) a += opt.pad;
    if (S + s.end < E - 0.01) b -= opt.pad;
    a = Math.max(S, a);
    b = Math.min(E, b);
    if (b - a >= 0.1) cuts.push([a, b]);
  }
  const keep: Array<[number, number]> = [];
  let cur = S;
  for (const [a, b] of cuts) {
    if (a - cur >= 0.04) keep.push([cur, a]);
    cur = b;
  }
  if (E - cur >= 0.04) keep.push([cur, E]);
  const kept = keep.reduce((n, [a, b]) => n + (b - a), 0);
  return {
    key: items.map((s) => `${s.video ? "V" : "A"}${s.track}@${s.start.toFixed(2)}`).join(","),
    start: S,
    end: E,
    keep,
    pauses: cuts.length,
    removed: E - S - kept,
  };
}

async function clipsOn(p: any, seq: any, video: boolean, track: number): Promise<any[]> {
  const CLIP = p.Constants?.TrackItemType?.CLIP ?? 1;
  const t = video ? await seq.getVideoTrack(track) : await seq.getAudioTrack(track);
  return (await t?.getTrackItems(CLIP, false)) ?? [];
}

async function findAt(p: any, seq: any, video: boolean, track: number, start: number): Promise<any | null> {
  for (const it of await clipsOn(p, seq, video, track)) if (Math.abs((await it.getStartTime()).seconds - start) < EPS) return it;
  return null;
}

/** Вырезать найденные паузы (план из findPauses для того же выделения). */
export async function cutPauses(plan: PausePlan, report: (t: string) => void = () => {}): Promise<string> {
  const { p, project, seq, items } = await selection();
  const key = items.map((s) => `${s.video ? "V" : "A"}${s.track}@${s.start.toFixed(2)}`).join(",");
  if (key !== plan.key) throw new HostToolError("Выделение изменилось — найдите паузы заново.");
  if (plan.keep.length === 0) throw new HostToolError("В клипе одна тишина — нечего оставлять.");
  if (plan.pauses === 0) throw new HostToolError("Пауз не найдено.");
  const { start: S, end: E, keep } = plan;
  const group = items.filter((s) => Math.abs(s.start - S) < EPS && Math.abs(s.end - E) < EPS);
  if (!group.length) throw new HostToolError("Не нашёл выделенный клип.");
  const editor = p.SequenceEditor.getEditor(seq);
  const T = (x: number) => p.TickTime.createWithSeconds(x);
  const seqEnd = (await seq.getEndTime()).seconds;

  // Где окажется кусок k: временная позиция копии (справа от всего) и итоговая (вплотную).
  const span = E - S + 1;
  const tmpOff = (k: number) => seqEnd + 10 + (k - 1) * span - S; // сдвиг копии k (k ≥ 1) относительно исходника
  const packed: number[] = [];
  let acc = S;
  for (const [a, b] of keep) {
    packed.push(acc);
    acc += b - a;
  }
  const removed = E - acc;
  const order = [...group.filter((g) => g.video), ...group.filter((g) => !g.video)];

  // 1. Копии кусков 2…n (сначала видео, потом звук — если связанный звук скопировался сам, не дублируем).
  report(`Режу: ${keep.length} кусков…`);
  for (const g of order) {
    const need: number[] = [];
    for (let k = 1; k < keep.length; k++) if (!(await findAt(p, seq, g.video, g.track, S + tmpOff(k)))) need.push(k);
    if (!need.length) continue;
    run(project, "Ассистент: паузы — копии", (c) => {
      for (const k of need) c.addAction(editor.createCloneTrackItemAction(g.item, T(tmpOff(k)), 0, 0, false, false));
    });
  }

  // 2. Обрезка: исходник — первый кусок, копия k — кусок k (абсолютные времена, повтор безопасен).
  for (const g of order) {
    const acts: Array<() => any> = [];
    const orig = await findAt(p, seq, g.video, g.track, S);
    const [a0, b0] = keep[0];
    if (orig) {
      if ((await orig.getEndTime()).seconds - b0 > EPS) acts.push(() => orig.createSetEndAction(T(b0)));
      if (a0 - S > EPS) acts.push(() => orig.createSetStartAction(T(a0)));
    }
    for (let k = 1; k < keep.length; k++) {
      const off = tmpOff(k);
      const [a, b] = keep[k];
      // Копия ещё целая (старт S+off) или уже обрезанная связанным клипом (старт a+off).
      const cl = (await findAt(p, seq, g.video, g.track, S + off)) ?? (await findAt(p, seq, g.video, g.track, a + off));
      if (!cl) continue;
      if ((await cl.getEndTime()).seconds - (b + off) > EPS) acts.push(() => cl.createSetEndAction(T(b + off)));
      if (a + off - (await cl.getStartTime()).seconds > EPS) acts.push(() => cl.createSetStartAction(T(a + off)));
    }
    if (acts.length) run(project, "Ассистент: паузы — обрезка", (c) => acts.forEach((f) => c.addAction(f())));
  }

  // 3. Сдвиг кусков вплотную (дельта от текущего места — связанный клип мог уже сдвинуться).
  for (const g of order) {
    const moves: Array<{ it: any; d: number }> = [];
    const first = await findAt(p, seq, g.video, g.track, keep[0][0]);
    if (first && Math.abs(keep[0][0] - packed[0]) > EPS) moves.push({ it: first, d: packed[0] - keep[0][0] });
    for (let k = 1; k < keep.length; k++) {
      const cl = await findAt(p, seq, g.video, g.track, keep[k][0] + tmpOff(k));
      if (cl) moves.push({ it: cl, d: packed[k] - (keep[k][0] + tmpOff(k)) });
    }
    if (moves.length) run(project, "Ассистент: паузы — вплотную", (c) => moves.forEach((m) => c.addAction(m.it.createMoveAction(T(m.d)))));
  }

  // 4. Клипы правее на тех же дорожках — влево на вырезанное время. Сначала запоминаем, где они стояли,
  //    двигаем видео, затем звук — только тот, что ещё не сдвинулся вместе со связанным видео.
  const tracks = new Map<string, { video: boolean; track: number }>();
  for (const g of group) tracks.set(`${g.video}:${g.track}`, { video: g.video, track: g.track });
  const later: Array<{ video: boolean; track: number; was: number }> = [];
  for (const t of tracks.values()) {
    for (const it of await clipsOn(p, seq, t.video, t.track)) {
      const st = (await it.getStartTime()).seconds;
      if (st >= E - EPS && st < seqEnd + 5) later.push({ ...t, was: st });
    }
  }
  for (const video of [true, false]) {
    const moves: any[] = [];
    for (const l of later.filter((x) => x.video === video).sort((x, y) => x.was - y.was)) {
      const it = await findAt(p, seq, l.video, l.track, l.was); // ещё на старом месте — значит, не сдвинут
      if (it) moves.push(it);
    }
    if (moves.length) run(project, "Ассистент: паузы — сдвиг следующих", (c) => moves.forEach((it) => c.addAction(it.createMoveAction(T(-removed)))));
  }
  return `Вырезано пауз: ${plan.pauses} (${removed.toFixed(1)} с). Клипы правее на этих дорожках сдвинуты, другие дорожки (музыка) — нет. Отмена — несколько Ctrl+Z.`;
}
