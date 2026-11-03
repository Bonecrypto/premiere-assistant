import { HostToolError } from "../hostTools/types.ts";
import { applyHit } from "./hits.ts";
import { openKeysClient } from "./keysClient.ts";
import { ppro } from "./timeline.ts";

/**
 * Монтаж под бит: программа в трее (v12) ищет биты в выделенном музыкальном клипе (ffmpeg + свой алгоритм:
 * спектральный поток → темп → динамическое программирование). Дальше: маркеры на биты (для «Разложить по
 * маркерам») или «Удары» на каждом бите у выделенных видеоклипов.
 */

export interface BeatGrid {
  /** Биты — время на таймлайне. */
  times: number[];
  bpm: number;
  clip: string;
}

const AI_MIN_VERSION = 12;
const H = { "Content-Type": "application/json", "X-Premiere-Assistant": "1" };
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

/** Найти биты в выделенном клипе с музыкой. */
export async function findBeats(report: (t: string) => void = () => {}): Promise<BeatGrid> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const seq = await project?.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  const sel = await seq.getSelection();
  const items: any[] = (await sel?.getTrackItems()) ?? [];
  const isVideo = (it: any) => typeof it.isAdjustmentLayer === "function" && typeof it.createAddVideoTransitionAction === "function";
  const ref = items.find((it) => !isVideo(it)) ?? items[0];
  if (!ref) throw new HostToolError("Выделите на таймлайне клип с музыкой.");
  const pi = p.ClipProjectItem.cast(await ref.getProjectItem());
  const src: string = String((await pi?.getMediaFilePath?.().catch(() => "")) ?? "");
  if (!src) throw new HostToolError("У клипа нет файла — выделите музыку.");
  const speed = Number(await ref.getSpeed?.().catch(() => 1)) || 1;
  if (Math.abs(speed - 1) > 0.01) throw new HostToolError("У клипа изменена скорость — биты считаются по 100%.");
  const S = (await ref.getStartTime()).seconds;
  const dur = (await ref.getEndTime()).seconds - S;
  const ss = (await ref.getInPoint()).seconds;
  const name: string = (await ref.getName?.().catch(() => "")) || "музыка";

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
  report("Слушаю музыку…");
  const start = await getJson(`${base}/beats`, { method: "POST", headers: H, body: JSON.stringify({ in: src, ss, dur }) });
  if (!start.ok) throw new HostToolError(`Не получилось: ${start.error}`);
  for (;;) {
    await sleep(400);
    const j = await getJson(`${base}/job/${start.job}`);
    if (j.state === "error" || j.ok === false) throw new HostToolError(`Не получилось найти биты: ${j.error}`);
    if (j.state === "done") {
      const beats: number[] = j.result?.beats ?? [];
      if (beats.length < 2) throw new HostToolError("Битов не нашлось — это точно музыка с ритмом?");
      return { times: beats.map((b) => Math.round((S + b) * 1000) / 1000).filter((t) => t < S + dur), bpm: j.result?.bpm ?? 0, clip: name };
    }
  }
}

/** Каждый n-й бит, начиная с offset (0 — первый найденный). */
export function pickBeats(grid: BeatGrid, every: number, offset = 0): number[] {
  return grid.times.filter((_, i) => i >= offset && (i - offset) % Math.max(1, every) === 0);
}

/** Маркеры на биты. */
export async function beatMarkers(times: number[]): Promise<string> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const seq = await project?.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  if (times.length > 1000) throw new HostToolError(`Слишком много битов (${times.length}) — возьмите «каждый 2-й» или «каждый 4-й».`);
  const markers = await p.Markers.getMarkers(seq);
  const type = p.Marker?.MARKER_TYPE_COMMENT ?? "Comment";
  run(project, "Ассистент: маркеры на биты", (c) => {
    times.forEach((t, i) => c.addAction(markers.createAddMarkerAction(`Бит ${i + 1}`, type, p.TickTime.createWithSeconds(t), p.TickTime.TIME_ZERO, "")));
  });
  return `Маркеров на биты: ${times.length}. Дальше — «По маркерам», чтобы разложить клипы под бит. Отмена — Ctrl+Z.`;
}

/** «Удар» на каждом бите у выделенных видеоклипов. */
export function beatHits(hitId: string, times: number[]): Promise<string> {
  return applyHit(hitId, times);
}
