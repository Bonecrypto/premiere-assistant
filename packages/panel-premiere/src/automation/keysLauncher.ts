import { storageGet, storageSet, uxp } from "../env.ts";
import { updateRepo } from "../update/version.ts";

/**
 * Встроенный «нажиматель клавиш»: маленькая программа без окон (значок в трее, tools/keys-app, Go + Win32).
 * Панель при первом использовании скачивает её из релиза GitHub в свою папку данных и запускает
 * напрямую (uxp.shell.openPath; в manifest — launchProcess.extensions ".exe"), запасной путь — короткий .cmd. Программа сама закрывается через минуту после закрытия Premiere.
 */

/** Версия программы — менять вместе с `version` в tools/keys-app/server.go, чтобы панель скачала новую. */
const EXE_VERSION = "6";
const EXE_NAME = "PremiereAssistantKeys.exe";
const VER_KEY = "keysExeVersion";

function ascii(s: string): ArrayBuffer {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0x7f;
  return b.buffer;
}

async function keysFolder(u: any): Promise<any> {
  const data = await u.storage.localFileSystem.getDataFolder();
  try {
    return await data.getEntry("keys");
  } catch {
    return data.createFolder("keys");
  }
}

async function ensureExe(u: any, folder: any): Promise<void> {
  let exists = false;
  try {
    await folder.getEntry(EXE_NAME);
    exists = true;
  } catch {
    /* нет — скачаем */
  }
  if (exists && storageGet(VER_KEY) === EXE_VERSION) return;
  const repo = updateRepo() || "Bonecrypto/premiere-assistant";
  const res = await fetch(`https://github.com/${repo}/releases/latest/download/premiere-assistant-keys.exe`);
  if (!res.ok) throw new Error(`не удалось скачать программу (${res.status})`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 100_000) throw new Error("скачался не тот файл");
  const f = await folder.createFile(EXE_NAME, { overwrite: true });
  await f.write(buf, { format: u.storage.formats.binary });
  storageSet(VER_KEY, EXE_VERSION);
}

/** Запустить нажиматель. Возвращает "" если запущен, иначе текст ошибки. */
export async function launchKeysHelper(): Promise<string> {
  const u: any = uxp;
  if (!u?.storage?.localFileSystem || !u?.shell?.openPath) return "автозапуск недоступен в этой версии Premiere";
  try {
    const folder = await keysFolder(u);
    await ensureExe(u, folder);
    const note = "Premiere Assistant запустит маленькую программу (значок в трее), которая нажимает клавиши цветов для покраски таймлайна.";
    // 1) Программа напрямую — без мелькания консоли (manifest: launchProcess.extensions ".exe").
    const exe = await folder.getEntry(EXE_NAME);
    let res: string = await u.shell.openPath(exe.nativePath, note).catch((e: Error) => e?.message || String(e));
    if (res) {
      // 2) Запасной путь — короткий .cmd (manifest: ".cmd").
      const cmd = await folder.createFile("start-keys.cmd", { overwrite: true });
      await cmd.write(ascii(`@echo off\r\nstart "" "%~dp0${EXE_NAME}"\r\n`), { format: u.storage.formats.binary });
      const res2: string = await u.shell.openPath(cmd.nativePath, note).catch((e: Error) => e?.message || String(e));
      res = res2 ? `${res} | ${res2}` : "";
    }
    return res || "";
  } catch (err) {
    return (err as Error)?.message || String(err);
  }
}
