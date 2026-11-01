import { storageGet, storageSet } from "../env.ts";
import { isLabelKey, type LabelKey } from "./labels.ts";

/**
 * Правила покраски таймлайна. Хранятся в панели (localStorage) и «доучиваются»:
 * пользователь меняет их во вкладке «Авто» или просит ассистента в чате.
 */

export type CategoryId = "music" | "sfx" | "voice" | "camera_audio" | "video" | "graphics" | "adjustment";

export interface CategoryRule {
  id: CategoryId;
  name: string;
  label: LabelKey;
  /** Слова в имени дорожки, клипа или пути к файлу (без учёта регистра). */
  keywords: string[];
  enabled: boolean;
}

/** Ручные уточнения: если имя клипа или путь содержит match — это категория category. */
export interface Override {
  match: string;
  category: CategoryId;
}

export interface ColorRules {
  version: 1;
  categories: CategoryRule[];
  overrides: Override[];
  /** Аудиофайл длиннее — скорее музыка; короче — скорее звуковой эффект (если слова не подсказали). */
  musicMinSeconds: number;
}

export const CATEGORY_ORDER: CategoryId[] = ["music", "sfx", "voice", "camera_audio", "video", "graphics", "adjustment"];

export const DEFAULT_RULES: ColorRules = {
  version: 1,
  musicMinSeconds: 20,
  overrides: [],
  categories: [
    {
      id: "music",
      name: "Музыка",
      label: "ROSE",
      enabled: true,
      keywords: ["music", "музык", "song", "track", "трек", "ost", "soundtrack", "bgm", "beat", "бит", "мелод", "melody", "instrumental"],
    },
    {
      id: "sfx",
      name: "Звуковые эффекты",
      label: "PURPLE",
      enabled: true,
      keywords: [
        "sfx", "fx", "sound effect", "звук", "эффект", "whoosh", "woosh", "swoosh", "swish", "swipe", "hit", "impact",
        "riser", "boom", "click", "pop", "glitch", "transition", "переход", "удар", "свуш", "щелч", "ding", "stinger",
      ],
    },
    {
      id: "voice",
      name: "Голос",
      label: "CERULEAN",
      enabled: true,
      keywords: ["vo", "voice", "voiceover", "голос", "озвуч", "диктор", "interview", "интервью", "dialog", "диалог", "narration", "podcast"],
    },
    { id: "camera_audio", name: "Звук с камеры", label: "TEAL", enabled: true, keywords: [] },
    { id: "video", name: "Видео", label: "IRIS", enabled: true, keywords: [] },
    { id: "graphics", name: "Графика и титры", label: "MANGO", enabled: true, keywords: ["title", "титр", "logo", "лого", "graphic", "граф", "text", "текст", "lower third"] },
    { id: "adjustment", name: "Корректирующие слои", label: "YELLOW", enabled: true, keywords: [] },
  ],
};

const KEY = "colorRules";

export function loadRules(): ColorRules {
  try {
    const raw = storageGet(KEY);
    if (!raw) return structuredCloneSafe(DEFAULT_RULES);
    return sanitize(JSON.parse(raw));
  } catch {
    return structuredCloneSafe(DEFAULT_RULES);
  }
}

const listeners = new Set<(r: ColorRules) => void>();

/** Подписка на изменения правил (например, ассистент дописал слово — вкладка «Авто» обновится). */
export function onRulesChange(fn: (r: ColorRules) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function saveRules(rules: ColorRules): ColorRules {
  const clean = sanitize(rules);
  storageSet(KEY, JSON.stringify(clean));
  for (const fn of listeners) fn(clean);
  return clean;
}

export function resetRules(): ColorRules {
  return saveRules(structuredCloneSafe(DEFAULT_RULES));
}

export function categoryName(rules: ColorRules, id: CategoryId): string {
  return rules.categories.find((c) => c.id === id)?.name ?? id;
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Приводим сохранённые/присланные правила к корректному виду (новые категории — из умолчаний). */
function sanitize(input: unknown): ColorRules {
  const base = structuredCloneSafe(DEFAULT_RULES);
  const src = (input ?? {}) as Partial<ColorRules>;
  const cats = Array.isArray(src.categories) ? src.categories : [];
  base.categories = base.categories.map((def) => {
    const c = cats.find((x) => x && x.id === def.id);
    if (!c) return def;
    return {
      ...def,
      label: isLabelKey(c.label) ? c.label : def.label,
      enabled: typeof c.enabled === "boolean" ? c.enabled : def.enabled,
      keywords: Array.isArray(c.keywords)
        ? [...new Set(c.keywords.filter((k) => typeof k === "string").map((k) => k.trim().toLowerCase()).filter(Boolean))]
        : def.keywords,
    };
  });
  base.overrides = (Array.isArray(src.overrides) ? src.overrides : [])
    .filter((o) => o && typeof o.match === "string" && o.match.trim() && CATEGORY_ORDER.includes(o.category))
    .map((o) => ({ match: o.match.trim().toLowerCase(), category: o.category }));
  if (typeof src.musicMinSeconds === "number" && src.musicMinSeconds > 0) base.musicMinSeconds = src.musicMinSeconds;
  return base;
}
