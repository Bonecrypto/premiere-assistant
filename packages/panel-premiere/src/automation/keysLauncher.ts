import ps1Text from "../../../../tools/keys-helper/PremiereAssistantKeys.ps1?raw";
import { uxp } from "../env.ts";

/**
 * Встроенный «нажиматель клавиш»: скрипт вшит в плагин. Панель сама кладёт его в свою папку данных
 * и запускает свёрнутым окном (uxp.shell.openPath — Windows один раз спросит разрешение; в manifest —
 * launchProcess.extensions ".cmd"). Скрипт сам выключается через минуту после закрытия Premiere.
 */

/** UTF-8 без TextEncoder (в UXP его может не быть). */
function utf8Bytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

// Окно с ASCII-заголовком: cmd без chcp читает файл в OEM-кодировке.
const LAUNCHER = [
  "@echo off",
  'start "Premiere Assistant keys" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PremiereAssistantKeys.ps1"',
  "",
].join("\r\n");

/** Запустить нажиматель. Возвращает "" если запущен, иначе текст ошибки. */
export async function launchKeysHelper(): Promise<string> {
  const u: any = uxp;
  const fs = u?.storage?.localFileSystem;
  if (!fs || !u?.shell?.openPath) return "автозапуск недоступен в этой версии Premiere";
  try {
    const data = await fs.getDataFolder();
    let folder: any;
    try {
      folder = await data.getEntry("keys");
    } catch {
      folder = await data.createFolder("keys");
    }
    const bin = u.storage.formats.binary;
    // PowerShell 5 читает UTF-8 только с BOM — иначе русские сообщения будут «кракозябрами».
    const body = utf8Bytes(ps1Text.replace(/^﻿/, "").replace(/\r?\n/g, "\r\n"));
    const withBom = new Uint8Array(body.length + 3);
    withBom.set([0xef, 0xbb, 0xbf]);
    withBom.set(body, 3);
    const ps1 = await folder.createFile("PremiereAssistantKeys.ps1", { overwrite: true });
    await ps1.write(withBom.buffer, { format: bin });
    const cmd = await folder.createFile("start-keys.cmd", { overwrite: true });
    await cmd.write(utf8Bytes(LAUNCHER).buffer, { format: bin });
    const res: string = await u.shell.openPath(
      cmd.nativePath,
      "Premiere Assistant запустит маленький помощник, который нажимает клавиши цветов для покраски таймлайна.",
    );
    return res || "";
  } catch (err) {
    return (err as Error)?.message || String(err);
  }
}
