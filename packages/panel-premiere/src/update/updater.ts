import { uxp } from "../env.ts";
import { setInstalledUpdate } from "./loader.ts";
import { APP_VERSION, compareVersions, updateRepo } from "./version.ts";

export interface UpdateInfo {
  version: string;
  notes: string;
  bundleUrl: string;
  publishedAt: string;
}

/** Есть ли на GitHub версия новее запущенной. Публичный репозиторий — ключ не нужен. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const repo = updateRepo();
  if (!repo) return null;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return null; // релизов ещё нет (или репозиторий закрыт)
  if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
  const data = (await res.json()) as {
    tag_name: string;
    body?: string;
    published_at?: string;
    assets?: Array<{ name: string; browser_download_url: string }>;
  };
  const version = data.tag_name.replace(/^v/, "");
  const asset = data.assets?.find((a) => a.name === "index.js");
  if (!asset || compareVersions(version, APP_VERSION) <= 0) return null;
  return { version, notes: (data.body ?? "").trim(), bundleUrl: asset.browser_download_url, publishedAt: data.published_at ?? "" };
}

/** Скачивает обновление в папку данных плагина и отмечает его к запуску. */
export async function downloadUpdate(info: UpdateInfo): Promise<void> {
  const res = await fetch(info.bundleUrl);
  if (!res.ok) throw new Error(`Не удалось скачать обновление (${res.status})`);
  const code = await res.text();
  if (code.length < 1000) throw new Error("Скачанный файл обновления повреждён");
  const fs = (uxp as any)?.storage?.localFileSystem;
  if (!fs) throw new Error("Файлы недоступны: панель запущена вне Premiere.");
  const folder = await fs.getDataFolder();
  const file = `update-${info.version}.js`;
  const entry = await folder.createFile(file, { overwrite: true });
  await entry.write(code);
  setInstalledUpdate({ version: info.version, file });
}

/** Перезапуск панели, чтобы загрузилась новая версия. */
export function reloadPanel(): boolean {
  try {
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

/** Вернуться к версии, установленной из .ccx. */
export function resetToBuiltin(): void {
  setInstalledUpdate(null);
}
