import { HostToolError } from "../hostTools/types.ts";
import { storageGet, storageSet } from "../env.ts";
import { ppro } from "./timeline.ts";

/**
 * «Папки проекта»: одним нажатием — структура папок (бинов) нового проекта, чтобы сразу к творчеству.
 * Шаблон — строки «Папка» или «Папка/Подпапка» (localStorage `binTemplate`). Уже существующие папки
 * не трогаются и не дублируются — нажимать можно сколько угодно раз. FolderItem.createBinAction.
 */

export const DEFAULT_BIN_TEMPLATE = [
  "01 Footage",
  "01 Footage/Video",
  "01 Footage/Photo",
  "02 Audio",
  "02 Audio/Music",
  "02 Audio/SFX",
  "02 Audio/Voice",
  "03 Graphics",
  "03 Graphics/Titles",
  "03 Graphics/PNG",
  "04 Sequences",
  "05 Archive",
];

/** Первый (русский) шаблон — если пользователь его не менял, заменяем на английский. */
const OLD_RU_TEMPLATE = [
  "01 Материалы",
  "01 Материалы/Видео",
  "01 Материалы/Фото",
  "02 Аудио",
  "02 Аудио/Музыка",
  "02 Аудио/SFX",
  "02 Аудио/Голос",
  "03 Графика",
  "03 Графика/Титры",
  "03 Графика/PNG",
  "04 Секвенции",
  "05 Архив",
];

const TPL_KEY = "binTemplate";
const AUTO_KEY = "binAutoCreate";
const DONE_KEY = "binAutoDone";

const clean = (s: string) =>
  s
    .split("/")
    .map((x) => x.trim())
    .filter(Boolean)
    .join("/");

export function loadBinTemplate(): string[] {
  try {
    const v = JSON.parse(storageGet(TPL_KEY) || "null");
    if (Array.isArray(v)) {
      const list = v.map((x) => clean(String(x))).filter(Boolean);
      if (list.join("|") === OLD_RU_TEMPLATE.join("|")) return [...DEFAULT_BIN_TEMPLATE];
      return list;
    }
  } catch {
    /* по умолчанию */
  }
  return [...DEFAULT_BIN_TEMPLATE];
}

export function saveBinTemplate(list: string[]): void {
  storageSet(TPL_KEY, JSON.stringify(list.map(clean).filter(Boolean)));
}

/** Все пути шаблона вместе с родителями («A/B» → «A», «A/B»), без повторов, по глубине. */
export function expandPaths(paths: string[]): string[] {
  const out = new Set<string>();
  for (const p of paths.map(clean).filter(Boolean)) {
    const parts = p.split("/");
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"));
  }
  return [...out].sort((a, b) => a.split("/").length - b.split("/").length);
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

async function childFolders(p: any, folder: any): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  for (const it of (await folder.getItems()) ?? []) {
    const f = p.FolderItem.cast(it);
    if (f) map.set(String(it.name ?? "").trim().toLowerCase(), f);
  }
  return map;
}

/**
 * Создаёт недостающие папки (с подпапками) и возвращает путь → папка для всех нужных путей.
 * По уровню глубины — одна транзакция (обычно 2 шага Ctrl+Z на всю структуру).
 */
export async function ensureFolders(project: any, paths: string[]): Promise<{ folders: Map<string, any>; created: string[] }> {
  const p = ppro() as any;
  const root = await project.getRootItem();
  const folders = new Map<string, any>([["", root]]);
  const created: string[] = [];
  const all = expandPaths(paths);
  const maxDepth = Math.max(0, ...all.map((x) => x.split("/").length));
  for (let d = 1; d <= maxDepth; d++) {
    const level = all.filter((x) => x.split("/").length === d);
    const resolve = async () => {
      const missing: Array<{ path: string; parent: any; name: string }> = [];
      const cache = new Map<any, Map<string, any>>();
      for (const path of level) {
        const parts = path.split("/");
        const parent = folders.get(parts.slice(0, -1).join("/"));
        if (!parent) continue;
        if (!cache.has(parent)) cache.set(parent, await childFolders(p, parent));
        const f = cache.get(parent)!.get(parts[parts.length - 1].toLowerCase());
        if (f) folders.set(path, f);
        else missing.push({ path, parent, name: parts[parts.length - 1] });
      }
      return missing;
    };
    const missing = await resolve();
    if (missing.length) {
      run(project, "Ассистент: папки проекта", (c) => {
        for (const m of missing) c.addAction(m.parent.createBinAction(m.name, false));
      });
      created.push(...missing.map((m) => m.path));
      await resolve();
    }
  }
  folders.delete("");
  return { folders, created };
}

export async function createProjectBins(template = loadBinTemplate()): Promise<string> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  if (!template.length) throw new HostToolError("Шаблон папок пуст — добавьте папки.");
  const { created } = await ensureFolders(project, template);
  if (!created.length) return "Все папки уже есть — ничего не добавлено.";
  return `Создано папок: ${created.length} (${created.filter((x) => !x.includes("/")).join(", ") || created[0]}). Отмена — Ctrl+Z.`;
}

/** Куда класть файл категории при «Разложить по папкам»: самая глубокая подходящая папка шаблона. */
const CAT_RE: Record<string, RegExp[]> = {
  photo: [/фото|photo|image|картин/i, /png|графика|graphics/i, /материал|media|footage|исходник/i],
  video: [/видео|video|footage|съ[её]мк/i, /материал|media|исходник/i],
  camera_audio: [/видео|video|footage|съ[её]мк/i, /материал|media|исходник/i],
  music: [/музык|music/i, /аудио|audio|звук/i],
  sfx: [/sfx|звуки|эффект/i, /аудио|audio|звук/i],
  voice: [/голос|voice|озвуч/i, /аудио|audio|звук/i],
  graphics: [/png|графика|graphics/i],
  adjustment: [/графика|graphics/i],
  text: [/титр|текст|title|mogrt/i, /графика|graphics/i],
  sequence: [/секвенц|sequence|таймлайн|timeline/i],
  other: [/прочее|other|misc/i, /материал|media|footage|исходник/i],
};

export function templatePathFor(cat: string, template = loadBinTemplate()): string | null {
  const all = expandPaths(template);
  for (const re of CAT_RE[cat] ?? []) {
    const hits = all.filter((p) => re.test(p.split("/").pop() ?? "")).sort((a, b) => b.split("/").length - a.split("/").length);
    if (hits.length) return hits[0];
  }
  return null;
}

export function isAutoBins(): boolean {
  return storageGet(AUTO_KEY) === "1";
}
export function setAutoBins(v: boolean): void {
  storageSet(AUTO_KEY, v ? "1" : "0");
}

/**
 * Автоматически: если открыт новый пустой проект (в корне ничего нет) — создать структуру.
 * Каждый проект — один раз (путь запоминается), чтобы не возвращать папки, которые вы удалили.
 */
export async function autoCreateIfEmpty(): Promise<string | null> {
  if (!isAutoBins()) return null;
  const p = ppro() as any;
  const project = await p.Project.getActiveProject().catch(() => null);
  if (!project) return null;
  const id = String(project.path || project.name || "");
  let done: string[] = [];
  try {
    done = JSON.parse(storageGet(DONE_KEY) || "[]");
  } catch {
    done = [];
  }
  if (!id || done.includes(id)) return null;
  const root = await project.getRootItem();
  const items = (await root.getItems()) ?? [];
  const remember = () => storageSet(DONE_KEY, JSON.stringify([...done, id].slice(-200)));
  if (items.length > 0) {
    remember(); // проект уже не пустой — не трогаем
    return null;
  }
  const r = await createProjectBins();
  remember();
  return r;
}
