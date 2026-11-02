import type { CategoryId, ColorRules } from "./rules.ts";

/** Что известно о клипе на таймлайне — достаточно, чтобы решить, к чему он относится. */
export interface ClipInfo {
  kind: "video" | "audio";
  trackName: string;
  clipName: string;
  mediaPath: string;
  durationSeconds: number;
  isAdjustment: boolean;
  /** «A1», «V2» — для ролей дорожек. */
  trackKey?: string;
}

export interface Classification {
  category: CategoryId;
  /** Почему так решили — показываем пользователю и модели. */
  reason: string;
}

const VIDEO_EXT = ["mp4", "mov", "mxf", "avi", "mkv", "m4v", "mts", "m2ts", "r3d", "braw", "webm", "wmv", "mpg", "mpeg", "3gp", "dng"];
const AUDIO_EXT = ["wav", "mp3", "aif", "aiff", "m4a", "aac", "flac", "ogg", "wma", "opus"];
const IMAGE_EXT = ["png", "jpg", "jpeg", "psd", "ai", "tif", "tiff", "gif", "bmp", "svg", "eps", "webp", "heic", "exr", "tga", "mogrt", "aep", "prtl"];

function ext(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path.trim());
  return m ? m[1].toLowerCase() : "";
}

/** Разбивка на слова: «Whoosh_Fast-01.wav» → whoosh, fast, 01, wav. */
function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-zа-яё0-9]+/i).filter(Boolean);
}

/**
 * Совпадение слова-подсказки: короткие (≤3 букв, например «vo», «fx») — только целым словом,
 * длинные — по началу слова («музык» → «музыка», «trans» не путаем с «trance» и т. п.).
 * Фразы с пробелом («sound effect») ищем как подстроку.
 */
function matches(keyword: string, text: string, toks: string[]): boolean {
  const k = keyword.toLowerCase().trim();
  if (!k) return false;
  if (k.includes(" ")) return text.toLowerCase().includes(k);
  if (k.length <= 3) return toks.includes(k);
  return toks.some((t) => t.startsWith(k));
}

function findByKeywords(rules: ColorRules, text: string, allowed: CategoryId[]): CategoryId | null {
  const toks = tokens(text);
  for (const id of allowed) {
    const cat = rules.categories.find((c) => c.id === id);
    if (cat && cat.keywords.some((k) => matches(k, text, toks))) return id;
  }
  return null;
}

const AUDIO_CATS: CategoryId[] = ["voice", "sfx", "music"];
const VIDEO_CATS: CategoryId[] = ["graphics"];

export function classify(clip: ClipInfo, rules: ColorRules): Classification {
  const full = `${clip.clipName} ${clip.mediaPath}`.toLowerCase();

  // 1. Ручные уточнения пользователя — главнее всего.
  for (const o of rules.overrides) {
    if (full.includes(o.match)) return { category: o.category, reason: `ваше правило «${o.match}»` };
  }
  // 2. Роль дорожки, заданная пользователем (A1 — голос и т. п.).
  const role = clip.trackKey ? rules.trackRoles?.[clip.trackKey] : undefined;
  if (role && !(clip.kind === "video" && clip.isAdjustment)) return { category: role, reason: `роль дорожки ${clip.trackKey}` };

  if (clip.kind === "video") {
    if (clip.isAdjustment) return { category: "adjustment", reason: "корректирующий слой" };
    const e = ext(clip.mediaPath);
    if (IMAGE_EXT.includes(e)) return { category: "graphics", reason: `файл .${e}` };
    if (!clip.mediaPath) return { category: "graphics", reason: "клип без медиафайла (графика/титр)" };
    const byName = findByKeywords(rules, `${clip.trackName} ${clip.clipName}`, VIDEO_CATS);
    if (byName) return { category: byName, reason: "по названию" };
    return { category: "video", reason: e ? `видеофайл .${e}` : "видео" };
  }

  // Аудио: сначала название дорожки (если вы их подписываете — это самый точный признак).
  const byTrack = findByKeywords(rules, clip.trackName, AUDIO_CATS);
  if (byTrack) return { category: byTrack, reason: `дорожка «${clip.trackName}»` };

  const byName = findByKeywords(rules, `${clip.clipName} ${clip.mediaPath}`, AUDIO_CATS);
  if (byName) return { category: byName, reason: "по названию файла" };

  const e = ext(clip.mediaPath);
  if (VIDEO_EXT.includes(e)) return { category: "camera_audio", reason: `звук из видеофайла .${e}` };

  if (clip.durationSeconds >= rules.musicMinSeconds) {
    return { category: "music", reason: `аудио длиннее ${rules.musicMinSeconds} с` };
  }
  return {
    category: "sfx",
    reason: AUDIO_EXT.includes(e) || !e ? `короткое аудио (${Math.round(clip.durationSeconds * 10) / 10} с)` : "аудио",
  };
}
