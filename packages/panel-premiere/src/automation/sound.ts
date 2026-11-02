import { HostToolError } from "../hostTools/types.ts";
import { classify } from "./classify.ts";
import { loadRules } from "./rules.ts";
import { ppro, readTimeline } from "./timeline.ts";

/**
 * «Звук»: громкость аудиоклипов через встроенный эффект Volume → параметр Level.
 * Premiere хранит Level не в дБ: значение = 10^((дБ − 15) / 20) (0 дБ ≈ 0.1778) — так же, как в ExtendScript;
 * при первом чтении проверяем, что значение похоже на эту шкалу.
 * Ключи — в медиа-времени клипа (getInPoint), как у анимаций.
 */

export interface SoundResult {
  clips: number;
  skipped: string[];
  note?: string;
}

export const dbToLevel = (db: number) => (db <= -96 ? 0 : Math.pow(10, (db - 15) / 20));
export const levelToDb = (v: number) => (v <= 0 ? -Infinity : 20 * Math.log10(v) + 15);

const LEVEL_NAMES = ["level", "уровень"];
const VOLUME_NAMES = ["volume", "громкость"];

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

/** Параметр Level эффекта Volume у аудиоклипа. */
async function levelParam(item: any): Promise<any | null> {
  const chain = await item.getComponentChain();
  for (let i = 0; i < chain.getComponentCount(); i++) {
    const comp = chain.getComponentAtIndex(i);
    const match = String((await comp.getMatchName()) ?? "").toLowerCase();
    const disp = String((await comp.getDisplayName?.().catch(() => "")) ?? "").toLowerCase();
    if (!/volume/.test(match) && !VOLUME_NAMES.includes(disp)) continue;
    const n: number = comp.getParamCount();
    for (let j = 0; j < n; j++) {
      const prm = comp.getParam(j);
      if (LEVEL_NAMES.includes(String(prm?.displayName ?? "").trim().toLowerCase())) return prm;
    }
    if (n > 1) return comp.getParam(1); // Bypass, Level
  }
  return null;
}

const num = (v: any): number | null => {
  const x = v?.value?.value ?? v?.value ?? v;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};

async function audioSelection(): Promise<{ p: any; project: any; items: any[] }> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new HostToolError("Нет активной секвенции.");
  const sel = await sequence.getSelection();
  const all: any[] = (await sel?.getTrackItems()) ?? [];
  const items = all.filter((it) => typeof it?.createAddVideoTransitionAction !== "function");
  if (!items.length) throw new HostToolError(all.length ? "Выделены только видеоклипы — выделите аудиоклипы." : "Выделите аудиоклипы на таймлайне.");
  return { p, project, items };
}

/** Изменить громкость выделенных аудиоклипов на delta дБ или выставить уровень absolute (дБ). */
export async function changeLevel(mode: { delta?: number; absolute?: number }): Promise<SoundResult> {
  const { p, project, items } = await audioSelection();
  const res: SoundResult = { clips: 0, skipped: [] };
  const sets: Array<{ prm: any; v: number }> = [];
  for (const it of items) {
    const name = (await it.getName?.().catch(() => "")) || "клип";
    const prm = await levelParam(it);
    if (!prm) {
      res.skipped.push(`${name}: нет параметра Volume → Level`);
      continue;
    }
    if (prm.isTimeVarying?.()) {
      res.skipped.push(`${name}: у громкости есть ключи — не трогаю`);
      continue;
    }
    const cur = num(await prm.getStartValue()) ?? dbToLevel(0);
    if (cur > 10) res.note = "Значения громкости в непривычной шкале — проверьте результат на слух.";
    const db = typeof mode.absolute === "number" ? mode.absolute : levelToDb(cur) + (mode.delta ?? 0);
    sets.push({ prm, v: dbToLevel(Math.min(15, db)) });
    res.clips++;
  }
  if (!sets.length) throw new HostToolError(res.skipped[0] ?? "Нечего менять.");
  run(project, "Ассистент: громкость", (c) => {
    for (const s of sets) c.addAction(s.prm.createSetValueAction(s.prm.createKeyframe(s.v), true));
  });
  void p;
  return res;
}

interface Key {
  prm: any;
  t: number;
  v: number;
}

function addKeys(project: any, p: any, keys: Key[], enable: any[], title: string): void {
  const toEnable = enable.filter((prm) => !prm.isTimeVarying?.());
  if (toEnable.length) run(project, "Ассистент: анимация громкости", (c) => toEnable.forEach((prm) => c.addAction(prm.createSetTimeVaryingAction(true))));
  run(project, title, (c) => {
    for (const k of keys) {
      const kf = k.prm.createKeyframe(k.v);
      kf.position = p.TickTime.createWithSeconds(k.t);
      c.addAction(k.prm.createAddKeyframeAction(kf));
    }
  });
}

/** Фейды на входе/выходе выделенных аудиоклипов (секунды; 0 — без фейда). */
export async function fades(fadeIn: number, fadeOut: number): Promise<SoundResult> {
  const { p, project, items } = await audioSelection();
  const res: SoundResult = { clips: 0, skipped: [] };
  const keys: Key[] = [];
  const enable: any[] = [];
  for (const it of items) {
    const name = (await it.getName?.().catch(() => "")) || "клип";
    const prm = await levelParam(it);
    if (!prm) {
      res.skipped.push(`${name}: нет параметра Volume → Level`);
      continue;
    }
    const inS = (await it.getInPoint()).seconds;
    const outS = (await it.getOutPoint()).seconds;
    const len = outS - inS;
    const base = prm.isTimeVarying?.() ? dbToLevel(0) : (num(await prm.getStartValue()) ?? dbToLevel(0));
    const fi = Math.min(fadeIn, len / 2);
    const fo = Math.min(fadeOut, len / 2);
    if (fi > 0) keys.push({ prm, t: inS, v: 0 }, { prm, t: inS + fi, v: base });
    if (fo > 0) keys.push({ prm, t: outS - fo, v: base }, { prm, t: outS - 0.001, v: 0 });
    enable.push(prm);
    res.clips++;
  }
  if (!keys.length) throw new HostToolError(res.skipped[0] ?? "Нечего менять.");
  addKeys(project, p, keys, enable, "Ассистент: фейды");
  return res;
}

/**
 * Приглушить музыку под голосом: музыка (по правилам покраски) опускается на duckDb там, где звучит голос.
 * Плавность — fade секунд до и после фразы. Близкие фразы (< 0.6 с) объединяются.
 */
export async function duckMusic(duckDb: number, fade: number): Promise<SoundResult & { voiceParts: number }> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const data = await readTimeline();
  const rules = loadRules();
  const voice: Array<[number, number]> = [];
  const music: typeof data.clips = [];
  for (const c of data.clips) {
    if (c.kind !== "audio") continue;
    const cat = classify(c, rules).category;
    if (cat === "voice") voice.push([c.startSeconds, c.startSeconds + c.durationSeconds]);
    else if (cat === "music") music.push(c);
  }
  if (!voice.length) throw new HostToolError("Не нашёл голос на таймлайне. Назовите дорожку с голосом «Голос» (Авто → Дорожки) или подскажите в чате.");
  if (!music.length) throw new HostToolError("Не нашёл музыку на таймлайне. Назовите дорожку «Музыка» или подскажите в чате.");
  voice.sort((a, b) => a[0] - b[0]);
  const parts: Array<[number, number]> = [];
  for (const v of voice) {
    const last = parts[parts.length - 1];
    if (last && v[0] - last[1] < 0.6) last[1] = Math.max(last[1], v[1]);
    else parts.push([v[0], v[1]]);
  }
  const res: SoundResult & { voiceParts: number } = { clips: 0, skipped: [], voiceParts: parts.length };
  const keys: Key[] = [];
  const enable: any[] = [];
  for (const m of music) {
    const it: any = m.trackItem;
    const prm = await levelParam(it);
    if (!prm) {
      res.skipped.push(`${m.clipName}: нет параметра Volume → Level`);
      continue;
    }
    if (prm.isTimeVarying?.()) {
      res.skipped.push(`${m.clipName}: у громкости уже есть ключи — не трогаю`);
      continue;
    }
    const base = num(await prm.getStartValue()) ?? dbToLevel(0);
    const low = dbToLevel(levelToDb(base) + duckDb);
    const inS = (await it.getInPoint()).seconds;
    const s0 = m.startSeconds;
    const s1 = m.startSeconds + m.durationSeconds;
    const toMedia = (t: number) => inS + (t - s0);
    let any = false;
    for (const [a, b] of parts) {
      if (b <= s0 || a >= s1) continue;
      const a0 = Math.max(s0, a - fade);
      const a1 = Math.max(s0, a);
      const b1 = Math.min(s1, b);
      const b2 = Math.min(s1, b + fade);
      if (a0 < a1) keys.push({ prm, t: toMedia(a0), v: base });
      keys.push({ prm, t: toMedia(a1), v: low }, { prm, t: toMedia(b1), v: low });
      if (b2 > b1) keys.push({ prm, t: toMedia(b2), v: base });
      any = true;
    }
    if (any) {
      enable.push(prm);
      res.clips++;
    }
  }
  if (!keys.length) throw new HostToolError(res.skipped[0] ?? "Музыка и голос не пересекаются по времени.");
  addKeys(project, p, keys, enable, "Ассистент: приглушить музыку под голосом");
  return res;
}
