import { storageGet, storageSet, uxp } from "../env.ts";
import { APP_VERSION, compareVersions } from "./version.ts";

/**
 * Загрузка скачанного обновления. Установленный плагин (.ccx) содержит встроенную версию;
 * обновления хранятся в папке данных плагина и запускаются вместо неё, если они новее.
 * Для запуска кода из файла в manifest включено allowCodeGenerationFromStrings.
 */

export interface InstalledUpdate {
  version: string;
  file: string;
}

const META_KEY = "installedUpdate";

export function installedUpdate(): InstalledUpdate | null {
  try {
    const raw = storageGet(META_KEY);
    return raw ? (JSON.parse(raw) as InstalledUpdate) : null;
  } catch {
    return null;
  }
}

export function setInstalledUpdate(u: InstalledUpdate | null): void {
  storageSet(META_KEY, u ? JSON.stringify(u) : "");
}

/** true — запущена скачанная версия, встроенную рендерить не нужно. */
export async function tryLoadUpdate(): Promise<boolean> {
  const w = window as any;
  if (w.__paUpdateLoaded) return false; // мы уже и есть загруженное обновление
  const u = installedUpdate();
  if (!u || compareVersions(u.version, APP_VERSION) <= 0) return false;
  try {
    const fs = (uxp as any)?.storage?.localFileSystem;
    if (!fs) return false;
    const folder = await fs.getDataFolder();
    const entry = await folder.getEntry(u.file);
    const code: string = await entry.read();
    w.__paUpdateLoaded = true;
    w.__paRunningVersion = u.version;
    // eslint-disable-next-line no-new-func
    new Function(code)();
    return true;
  } catch (err) {
    console.error("Не удалось запустить обновление, работаю на встроенной версии:", err);
    w.__paUpdateLoaded = false;
    setInstalledUpdate(null);
    return false;
  }
}
