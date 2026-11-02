import { storageGet, storageSet, uxp } from "../env.ts";
import { HostToolError } from "../hostTools/types.ts";
import { ppro } from "../automation/timeline.ts";
import { listZip, readZipEntry } from "./zip.ts";

/**
 * Библиотека титров (.mogrt) внутри плагина.
 * Файлы копируются в папку данных плагина (uxp.storage.localFileSystem.getDataFolder()/mogrt/<раздел>/),
 * так что исходная папка больше не нужна, а обновления их не трогают.
 * Вставка — SequenceEditor.insertMogrtFromPath (Premiere UXP API 25.6+) под плейхед, на свободную дорожку.
 */

export interface Mogrt {
  /** Относительный путь: «Раздел/Имя.mogrt». */
  id: string;
  name: string;
  category: string;
  size: number;
}

const INDEX_KEY = "mogrtIndex";
const FAV_KEY = "mogrtFavorites";
export const DEFAULT_CATEGORY = "Общие";

function lfs(): any {
  const fs = (uxp as any)?.storage?.localFileSystem;
  if (!fs) throw new HostToolError("Файлы доступны только внутри Premiere.");
  return fs;
}

function binaryFormat(): any {
  return (uxp as any)?.storage?.formats?.binary;
}

async function root(create = true): Promise<any | null> {
  const data = await lfs().getDataFolder();
  try {
    return await data.getEntry("mogrt");
  } catch {
    return create ? data.createFolder("mogrt") : null;
  }
}

async function subfolder(parent: any, name: string): Promise<any> {
  try {
    return await parent.getEntry(name);
  } catch {
    return parent.createFolder(name);
  }
}

const cleanName = (file: string) => file.replace(/\.mogrt$/i, "").replace(/[_]+/g, " ").trim();
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").trim() || DEFAULT_CATEGORY;

export function loadIndex(): Mogrt[] {
  try {
    const v = JSON.parse(storageGet(INDEX_KEY) || "[]");
    return Array.isArray(v) ? v.filter((m) => m && m.id && m.name) : [];
  } catch {
    return [];
  }
}

function saveIndex(list: Mogrt[]): void {
  storageSet(INDEX_KEY, JSON.stringify(list));
}

export function loadFavorites(): string[] {
  try {
    const v = JSON.parse(storageGet(FAV_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids: string[]): void {
  storageSet(FAV_KEY, JSON.stringify(ids));
}

/** Пересобрать список по содержимому папки плагина. */
export async function rescan(): Promise<Mogrt[]> {
  const r = await root();
  const list: Mogrt[] = [];
  const walk = async (folder: any, category: string | null) => {
    for (const e of (await folder.getEntries()) ?? []) {
      if (e.isFolder) await walk(e, category ?? e.name);
      else if (/\.mogrt$/i.test(e.name)) {
        const cat = category ?? DEFAULT_CATEGORY;
        let size = 0;
        try {
          size = (await e.getMetadata?.())?.size ?? 0;
        } catch {
          /* размер не важен */
        }
        list.push({ id: `${cat}/${e.name}`, name: cleanName(e.name), category: cat, size });
      }
    }
  };
  await walk(r, null);
  list.sort((a, b) => a.category.localeCompare(b.category, "ru") || a.name.localeCompare(b.name, "ru"));
  saveIndex(list);
  return list;
}

export interface ImportResult {
  added: number;
  skipped: number;
  list: Mogrt[];
}

/** Выбрать папку (подпапки станут разделами) и скопировать все .mogrt в плагин. */
export async function importFolder(): Promise<ImportResult | null> {
  let src: any;
  try {
    src = await lfs().getFolder();
  } catch (err) {
    throw new HostToolError(
      "Premiere не дал открыть выбор папки. Переустановите плагин из последнего релиза (.ccx) — в нём есть разрешение на файлы.",
    );
  }
  if (!src) return null;
  const r = await root();
  let added = 0;
  let skipped = 0;
  const walk = async (folder: any, category: string) => {
    for (const e of (await folder.getEntries()) ?? []) {
      if (e.isFolder) {
        await walk(e, category === DEFAULT_CATEGORY && folder === src ? safeName(e.name) : category);
      } else if (/\.mogrt$/i.test(e.name)) {
        try {
          const dest = await subfolder(r, category);
          await e.copyTo(dest, { overwrite: true });
          added++;
        } catch {
          skipped++;
        }
      }
    }
  };
  await walk(src, DEFAULT_CATEGORY);
  return { added, skipped, list: await rescan() };
}

/** Добавить отдельные файлы в раздел. */
export async function importFiles(category: string): Promise<ImportResult | null> {
  let files: any[];
  try {
    files = await lfs().getFileForOpening({ allowMultiple: true, types: ["mogrt"] });
  } catch {
    throw new HostToolError("Premiere не дал открыть выбор файлов. Переустановите плагин из последнего релиза (.ccx).");
  }
  if (!files || (Array.isArray(files) && files.length === 0)) return null;
  const arr = Array.isArray(files) ? files : [files];
  const dest = await subfolder(await root(), safeName(category));
  let added = 0;
  let skipped = 0;
  for (const f of arr) {
    try {
      await f.copyTo(dest, { overwrite: true });
      added++;
    } catch {
      skipped++;
    }
  }
  return { added, skipped, list: await rescan() };
}

async function fileOf(m: Mogrt): Promise<any> {
  const r = await root(false);
  if (!r) throw new HostToolError("Библиотека пуста.");
  const [cat, ...rest] = m.id.split("/");
  const folder = await r.getEntry(cat);
  return folder.getEntry(rest.join("/"));
}

export async function removeMogrt(m: Mogrt): Promise<Mogrt[]> {
  const f = await fileOf(m);
  await f.delete();
  return rescan();
}

// ───────── Превью ─────────

const thumbs = new Map<string, string | null>();

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Картинка-превью из .mogrt (data URI) или null. */
export async function thumbnail(m: Mogrt): Promise<string | null> {
  if (thumbs.has(m.id)) return thumbs.get(m.id) ?? null;
  let uri: string | null = null;
  try {
    const f = await fileOf(m);
    const buf = new Uint8Array(await f.read({ format: binaryFormat() }));
    const entries = listZip(buf);
    const img =
      entries.find((e) => /(^|\/)thumb[^/]*\.png$/i.test(e.name)) ??
      entries.find((e) => /\.png$/i.test(e.name)) ??
      entries.find((e) => /\.jpe?g$/i.test(e.name));
    if (img && img.size < 4_000_000) {
      const data = readZipEntry(buf, img);
      uri = `data:image/${/\.png$/i.test(img.name) ? "png" : "jpeg"};base64,${toBase64(data)}`;
    }
  } catch {
    uri = null;
  }
  thumbs.set(m.id, uri);
  return uri;
}

// ───────── Вставка ─────────

/** Самая нижняя свободная видеодорожка над V1 в момент time; если все заняты — новая (номер = количество дорожек). */
async function freeVideoTrack(seq: any, seconds: number): Promise<number> {
  const p = ppro() as any;
  const count: number = await seq.getVideoTrackCount();
  const CLIP = p.Constants?.TrackItemType?.CLIP ?? 1;
  for (let i = 1; i < count; i++) {
    const track = await seq.getVideoTrack(i);
    const items: any[] = (await track?.getTrackItems(CLIP, false)) ?? [];
    let busy = false;
    for (const it of items) {
      const s = (await it.getStartTime())?.seconds ?? 0;
      const e = (await it.getEndTime())?.seconds ?? 0;
      if (seconds >= s - 0.001 && seconds < e) {
        busy = true;
        break;
      }
    }
    if (!busy) return i;
  }
  return count;
}

export async function insertMogrt(m: Mogrt, atSeconds?: number): Promise<{ track: number; at: number }> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const seq = await project.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  const f = await fileOf(m);
  const time = typeof atSeconds === "number" ? p.TickTime.createWithSeconds(atSeconds) : await seq.getPlayerPosition();
  const at = time?.seconds ?? 0;
  const track = await freeVideoTrack(seq, at);
  const editor = p.SequenceEditor.getEditor(seq);
  let error: unknown = null;
  let items: unknown[] = [];
  project.lockedAccess(() => {
    try {
      items = editor.insertMogrtFromPath(f.nativePath, time, track, 0) ?? [];
    } catch (err) {
      error = err;
    }
  });
  if (error) throw new HostToolError(`Premiere не вставил титр: ${(error as Error)?.message ?? error}`);
  if (!items.length) throw new HostToolError("Premiere не вставил титр (пустой результат). Проверьте, что шаблон открывается в Essential Graphics.");
  return { track, at };
}

export function findMogrt(query: string): Mogrt | null {
  const q = query.trim().toLowerCase();
  const list = loadIndex();
  return list.find((m) => m.id.toLowerCase() === q || m.name.toLowerCase() === q) ?? list.find((m) => m.name.toLowerCase().includes(q)) ?? null;
}
