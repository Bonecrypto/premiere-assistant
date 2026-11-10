import { helperDownMessage } from "./keysLauncher.ts";
import { storageGet, storageSet, uxp } from "../env.ts";
import { HostToolError } from "../hostTools/types.ts";
import { openKeysClient } from "./keysClient.ts";
import { ppro } from "./timeline.ts";

/**
 * Автосубтитры: программа в трее (v11) распознаёт речь выделенного клипа (ffmpeg + whisper.cpp, локально) →
 * слова с временем → фразы (длина строки, паузы, знаки препинания) → файл .srt в папке плагина → импорт в проект →
 * попытка положить на таймлайн с начала клипа (если API не даст — пользователь перетаскивает сам).
 */

export interface SubsOptions {
  lang: string; // auto | ru | uk | en
  maxChars: number;
  caps?: boolean;
}

interface Word {
  start: number;
  end: number;
  text: string;
}

const AI_MIN_VERSION = 11;
const CONSENT_KEY = "aiSubsConsent";
const H = { "Content-Type": "application/json", "X-Premiere-Assistant": "1" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const r: Response = await fetch(url, init);
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok && !j?.error) j.error = `ответ ${r.status}`;
  return j;
}

/** Слова → фразы для субтитров. */
export function groupWords(words: Word[], maxChars: number, maxDur = 3.5, gap = 0.7): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(" ") });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const len = cur.map((x) => x.text).join(" ").length + 1 + w.text.length;
      if (len > maxChars || w.end - cur[0].start > maxDur || w.start - prev.end > gap) flush();
    }
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  // Не даём фразе висеть до следующей, если между ними пауза; и не пересекаться.
  for (let i = 0; i < out.length - 1; i++) out[i].end = Math.min(out[i].end + 0.15, out[i + 1].start);
  return out;
}

function srtTime(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function toSrt(lines: Array<{ start: number; end: number; text: string }>, caps = false): string {
  return lines.map((l, i) => `${i + 1}\r\n${srtTime(l.start)} --> ${srtTime(l.end)}\r\n${caps ? l.text.toUpperCase() : l.text}\r\n`).join("\r\n");
}

/** UTF-8 с BOM — Premiere правильно читает кириллицу. */
function utf8Bom(s: string): ArrayBuffer {
  const bytes: number[] = [0xef, 0xbb, 0xbf];
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(bytes).buffer;
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

export async function makeSubtitles(opt: SubsOptions, report: (t: string) => void = () => {}): Promise<string> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const seq = await project?.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  const sel = await seq.getSelection();
  const items: any[] = (await sel?.getTrackItems()) ?? [];
  if (!items.length) throw new HostToolError("Выделите на таймлайне клип с речью.");
  const isVideo = (it: any) => typeof it.isAdjustmentLayer === "function" && typeof it.createAddVideoTransitionAction === "function";
  const ref = items.find((it) => !isVideo(it)) ?? items[0];
  const pi = p.ClipProjectItem.cast(await ref.getProjectItem());
  const src: string = String((await pi?.getMediaFilePath?.().catch(() => "")) ?? "");
  if (!src) throw new HostToolError("У клипа нет файла — субтитры делаются из записи с голосом.");
  const speed = Number(await ref.getSpeed?.().catch(() => 1)) || 1;
  if (Math.abs(speed - 1) > 0.01) throw new HostToolError("У клипа изменена скорость — верните 100% или сделайте Nest.");
  const S = (await ref.getStartTime()).seconds;
  const dur = (await ref.getEndTime()).seconds - S;
  const ss = (await ref.getInPoint()).seconds;

  report("Запускаю программу в трее…");
  let client;
  try {
    client = await openKeysClient(AI_MIN_VERSION);
  } catch {
    throw new HostToolError(helperDownMessage("Не запустилась программа в трее — нажмите ещё раз."));
  }
  client.close();
  const base = client.base!;

  // Распознавание речи — один раз скачать (~580 МБ) с согласия.
  const st = await getJson(`${base}/ai/status`);
  if (!st.subs) {
    if (!st.running) {
      if (storageGet(CONSENT_KEY) !== "1") {
        storageSet(CONSENT_KEY, "1");
        throw new HostToolError(
          `Для субтитров нужно один раз скачать распознавание речи (~${st.subsMB ?? 580} МБ: whisper.cpp и модель large-v3-turbo${st.ffmpeg ? "" : ", плюс ffmpeg ~90 МБ"}). Работает на компьютере, без интернета и бесплатно. Нажмите ещё раз — начну загрузку.`,
        );
      }
      const s = await getJson(`${base}/ai/setup?subs=1`, { method: "POST", headers: H, body: "{}" });
      if (!s.ok) throw new HostToolError(`Не начал загрузку: ${s.error}`);
    }
    for (;;) {
      await sleep(800);
      const q = await getJson(`${base}/ai/status`);
      if (q.subs) break;
      if (q.error) throw new HostToolError(`Загрузка не удалась: ${q.error}. Нажмите ещё раз.`);
      report(`Скачиваю ${q.stage || "распознавание речи"}… ${q.total ? Math.round((q.done / q.total) * 100) : 0}% (${Math.round((q.done || 0) / 1048576)} МБ)`);
    }
  }

  report(`Распознаю речь (${dur.toFixed(0)} с)…`);
  const t0 = Date.now();
  const start = await getJson(`${base}/transcribe`, { method: "POST", headers: H, body: JSON.stringify({ in: src, ss, dur, lang: opt.lang }) });
  if (!start.ok) throw new HostToolError(`Не получилось: ${start.error}`);
  let words: Word[] = [];
  let lang = "";
  for (;;) {
    await sleep(600);
    const j = await getJson(`${base}/job/${start.job}`);
    if (j.state === "error" || j.ok === false) throw new HostToolError(`Не получилось распознать: ${j.error}`);
    if (j.state === "done") {
      words = j.result?.words ?? [];
      lang = j.result?.language ?? "";
      break;
    }
    const pr = j.progress || 0;
    const left = pr > 0.1 ? Math.round((((Date.now() - t0) / pr) * (1 - pr)) / 1000) : 0;
    report(`Распознаю речь… ${Math.round(pr * 100)}%${left ? ` · осталось ~${left > 90 ? `${Math.round(left / 60)} мин` : `${left} с`}` : ""}`);
  }
  if (!words.length) throw new HostToolError("Речи не нашлось. Проверьте, что выделен клип с голосом.");

  const lines = groupWords(words, Math.max(12, Math.min(60, opt.maxChars)));
  const srt = toSrt(lines, opt.caps);

  // Файл .srt — в папке плагина, импорт в проект.
  const u: any = uxp;
  const data = await u.storage.localFileSystem.getDataFolder();
  let folder: any;
  try {
    folder = await data.getEntry("subtitles");
  } catch {
    folder = await data.createFolder("subtitles");
  }
  const name = src.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
  const file = await folder.createFile(`${name} — субтитры ${Date.now().toString(36)}.srt`, { overwrite: true });
  await file.write(utf8Bom(srt), { format: u.storage.formats.binary });
  const out: string = file.nativePath;
  report("Импортирую субтитры…");
  const ok = await project.importFiles([out], true);
  if (!ok) return `Субтитры готовы (${lines.length} фраз), но Premiere не импортировал файл. Перетащите его на таймлайн: ${out}`;

  // Найти импортированный элемент и попробовать положить на таймлайн с начала клипа.
  const root = await project.getRootItem();
  let imported: any = null;
  for (const it of (await root.getItems()) ?? []) {
    const c = p.ClipProjectItem.cast(it);
    const mp = String((await c?.getMediaFilePath?.().catch(() => "")) ?? "");
    if (mp && mp.toLowerCase().replace(/\//g, "\\") === out.toLowerCase().replace(/\//g, "\\")) imported = it;
  }
  let placed = false;
  if (imported) {
    try {
      const editor = p.SequenceEditor.getEditor(seq);
      run(project, "Ассистент: субтитры", (c) => c.addAction(editor.createOverwriteItemAction(imported, p.TickTime.createWithSeconds(S), 0, -1)));
      placed = true;
    } catch {
      placed = false;
    }
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  const langNote = lang ? ` Язык: ${lang}.` : "";
  return placed
    ? `Готово за ${secs} с: ${lines.length} фраз на таймлайне с начала клипа.${langNote} Стиль — в Essential Graphics / Properties. Отмена — Ctrl+Z.`
    : `Готово за ${secs} с: ${lines.length} фраз.${langNote} Файл субтитров уже в проекте (панель Project, «${name} — субтитры…») — перетащите его на таймлайн к началу клипа (${S.toFixed(2)} с).`;
}
