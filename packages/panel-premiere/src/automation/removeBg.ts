import { storageGet, storageSet, uxp } from "../env.ts";
import { HostToolError } from "../hostTools/types.ts";
import { openKeysClient } from "./keysClient.ts";
import { ppro } from "./timeline.ts";

/**
 * Удаление фона (картинки PNG/JPG): работу делает программа в трее (tools/keys-app, v8+):
 * нейросеть ISNet через ONNX Runtime, локально. Панель: выделенный клип → путь к файлу → /removebg →
 * опрос задания → импорт PNG с прозрачностью → на дорожку над исходником, то же время и Motion.
 * Вырезанный объект над исходником: между ними можно поставить текст — «текст за человеком».
 */

const AI_MIN_VERSION = 8;
const CONSENT_KEY = "aiSetupConsent";
const H = { "Content-Type": "application/json", "X-Premiere-Assistant": "1" };

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const r: Response = await fetch(url, init);
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok && !j?.error) j.error = `ответ ${r.status}`;
  return j;
}

/** Программа в трее нужной версии → её адрес. */
async function aiBase(): Promise<string> {
  let client;
  try {
    client = await openKeysClient(AI_MIN_VERSION);
  } catch {
    throw new HostToolError("Не запустилась программа в трее (она же делает покраску). Нажмите ещё раз; если не поможет — «Авто → Покраска таймлайна» подскажет, что не так.");
  }
  client.close();
  if (!client.base) throw new HostToolError("Нужна новая программа в трее — нажмите ещё раз, панель запустит её сама.");
  return client.base;
}

/** Нейросеть скачана? Если нет — с согласия пользователя скачать (~200 МБ) с прогрессом. */
async function ensureModel(base: string, report: (t: string) => void): Promise<void> {
  const st = await getJson(`${base}/ai/status`);
  if (st.ready) return;
  if (!st.running) {
    if (storageGet(CONSENT_KEY) !== "1") {
      storageSet(CONSENT_KEY, "1");
      throw new HostToolError(
        `Для удаления фона нужно один раз скачать нейросеть (~${st.sizeMB ?? 250} МБ: движок ONNX Runtime от Microsoft и модель ISNet). Работает на компьютере, без интернета и бесплатно. Нажмите плитку ещё раз — начну загрузку.`,
      );
    }
    const s = await getJson(`${base}/ai/setup`, { method: "POST", headers: H, body: "{}" });
    if (!s.ok) throw new HostToolError(`Не начал загрузку: ${s.error}`);
  }
  for (;;) {
    await sleep(700);
    const p = await getJson(`${base}/ai/status`);
    if (p.ready) return;
    if (p.error) throw new HostToolError(`Загрузка нейросети не удалась: ${p.error}. Нажмите ещё раз.`);
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    report(`Скачиваю ${p.stage || "нейросеть"}… ${pct}% (${Math.round((p.done || 0) / 1048576)} МБ)`);
  }
}

/** Скопировать постоянные значения Motion (позиция, масштаб, поворот…) с исходника. */
async function copyMotion(p: any, project: any, from: any, to: any): Promise<void> {
  const motion = async (it: any) => {
    const ch = await it.getComponentChain();
    for (let i = 0; i < ch.getComponentCount(); i++) {
      const c = ch.getComponentAtIndex(i);
      if (/motion/i.test(String(await c.getMatchName()))) return c;
    }
    return null;
  };
  const a = await motion(from);
  const b = await motion(to);
  if (!a || !b) return;
  const sets: Array<{ prm: any; v: unknown }> = [];
  for (let i = 0; i < a.getParamCount(); i++) {
    const src = a.getParam(i);
    const dst = b.getParam(i);
    if (!src || !dst || src.isTimeVarying?.() || dst.isTimeVarying?.()) continue;
    const raw = await src.getStartValue().catch(() => null);
    const v = raw?.value?.value ?? raw?.value ?? raw;
    if (typeof v === "number" || typeof v === "boolean") sets.push({ prm: dst, v });
    else if (Array.isArray(v) && v.length === 2) sets.push({ prm: dst, v: new p.PointF(v[0], v[1]) });
    else if (v && typeof v.x === "number") sets.push({ prm: dst, v: new p.PointF(v.x, v.y) });
  }
  if (!sets.length) return;
  try {
    run(project, "Ассистент: удаление фона — размер как у исходника", (c) => {
      for (const s of sets) {
        try {
          c.addAction(s.prm.createSetValueAction(s.prm.createKeyframe(s.v), true));
        } catch {
          /* пропустить */
        }
      }
    });
  } catch {
    /* не критично */
  }
}

export async function removeBackgroundSelected(report: (t: string) => void = () => {}): Promise<string> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const seq = await project?.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  const sel = await seq.getSelection();
  const items: any[] = ((await sel?.getTrackItems()) ?? []).filter((it: any) => typeof it.isAdjustmentLayer === "function");
  if (!items.length) throw new HostToolError("Выделите на таймлайне картинку (PNG/JPG), с которой убрать фон.");
  const item = items[0];
  const pi = p.ClipProjectItem.cast(await item.getProjectItem());
  const src: string = String((await pi?.getMediaFilePath?.().catch(() => "")) ?? "");
  if (!src) throw new HostToolError("У клипа нет файла (это титр или графика) — фон убирается с картинок.");
  if (!/\.(png|jpe?g)$/i.test(src)) throw new HostToolError("Пока убираю фон с картинок PNG и JPG. Видео — следующим шагом.");

  report("Запускаю программу в трее…");
  const base = await aiBase();
  await ensureModel(base, report);

  // Куда сохранить: папка данных плагина → removebg/
  const u: any = uxp;
  const data = await u.storage.localFileSystem.getDataFolder();
  let folder: any;
  try {
    folder = await data.getEntry("removebg");
  } catch {
    folder = await data.createFolder("removebg");
  }
  const name = src.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
  const outFile = await folder.createFile(`${name} — без фона ${Date.now().toString(36)}.png`, { overwrite: true });
  const out: string = outFile.nativePath;

  report("Убираю фон…");
  const start = await getJson(`${base}/removebg`, { method: "POST", headers: H, body: JSON.stringify({ in: src, out }) });
  if (!start.ok) throw new HostToolError(`Не получилось: ${start.error}`);
  for (;;) {
    await sleep(500);
    const j = await getJson(`${base}/job/${start.job}`);
    if (j.state === "error" || j.ok === false) throw new HostToolError(`Не получилось убрать фон: ${j.error}`);
    if (j.state === "done") break;
    report(`Убираю фон… ${Math.round((j.progress || 0) * 100)}%`);
  }

  // Импорт и на дорожку над исходником, то же время.
  report("Кладу на таймлайн…");
  const ok = await project.importFiles([out], true);
  if (!ok) throw new HostToolError("Premiere не импортировал результат. Файл: " + out);
  const root = await project.getRootItem();
  let imported: any = null;
  for (const it of (await root.getItems()) ?? []) {
    const c = p.ClipProjectItem.cast(it);
    const mp = String((await c?.getMediaFilePath?.().catch(() => "")) ?? "");
    if (mp && mp.toLowerCase().replace(/\//g, "\\") === out.toLowerCase().replace(/\//g, "\\")) imported = it;
  }
  if (!imported) throw new HostToolError("Результат сохранён, но не нашёл его в проекте: " + out);

  const s = (await item.getStartTime()).seconds;
  const e = (await item.getEndTime()).seconds;
  const own = await item.getTrackIndex();
  const CLIP = p.Constants?.TrackItemType?.CLIP ?? 1;
  const count: number = await seq.getVideoTrackCount();
  let track = count;
  for (let i = own + 1; i < count; i++) {
    const its: any[] = (await (await seq.getVideoTrack(i))?.getTrackItems(CLIP, false)) ?? [];
    let busy = false;
    for (const it of its) {
      if ((await it.getStartTime()).seconds < e - 0.001 && (await it.getEndTime()).seconds > s + 0.001) {
        busy = true;
        break;
      }
    }
    if (!busy) {
      track = i;
      break;
    }
  }
  const editor = p.SequenceEditor.getEditor(seq);
  const T = (x: number) => p.TickTime.createWithSeconds(x);
  run(project, "Ассистент: удаление фона", (c) => c.addAction(editor.createOverwriteItemAction(imported, T(s), track, -1)));
  const t = await seq.getVideoTrack(track);
  for (const it of (await t?.getTrackItems(CLIP, false)) ?? []) {
    if (Math.abs((await it.getStartTime()).seconds - s) < 0.01) {
      try {
        run(project, "Ассистент: удаление фона — длина", (c) => c.addAction(it.createSetEndAction(T(e))));
      } catch {
        /* длина по умолчанию */
      }
      await copyMotion(p, project, item, it);
      break;
    }
  }
  return `Готово: вырезанный объект на V${track + 1} над исходником. Поставьте текст между ними — получится «текст за объектом». Исходник можно выключить (Shift+E). Отмена — Ctrl+Z.`;
}
