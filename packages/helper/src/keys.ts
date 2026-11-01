import { spawn } from "node:child_process";
import { KEY_ALLOWLIST } from "@pa/core";

/**
 * Нажатие горячих клавиш в Premiere Pro (только Windows) — для автопокраски клипов на таймлайне.
 * Только комбинации из KEY_ALLOWLIST (фокус таймлайна и клавиши меток), никакого произвольного ввода.
 * Окно Premiere выводится на передний план (WScript.Shell.AppActivate), клавиши — SendKeys.
 */

function toSendKeys(combo: string): string {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop() ?? "";
  let mods = "";
  if (parts.includes("ctrl")) mods += "^";
  if (parts.includes("alt")) mods += "%";
  if (parts.includes("shift")) mods += "+";
  const k = /^f\d{1,2}$/.test(key) ? `{${key.toUpperCase()}}` : key;
  return mods + k;
}

export async function sendKeys(keys: string[]): Promise<void> {
  if (process.platform !== "win32") throw new Error("Нажатие клавиш работает только в Windows.");
  if (!keys.length || keys.length > 8) throw new Error("Неверный список клавиш.");
  for (const k of keys) {
    if (!KEY_ALLOWLIST.has(k.toLowerCase())) throw new Error(`Комбинация «${k}» не разрешена.`);
  }
  const lines = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$ws = New-Object -ComObject WScript.Shell",
    "$p = Get-Process | Where-Object { $_.ProcessName -like 'Adobe Premiere Pro*' } | Select-Object -First 1",
    "if (-not $p) { exit 2 }",
    "$null = $ws.AppActivate($p.Id)",
    "Start-Sleep -Milliseconds 120",
    ...keys.flatMap((k) => [`[System.Windows.Forms.SendKeys]::SendWait('${toSendKeys(k)}')`, "Start-Sleep -Milliseconds 140"]),
  ];
  await new Promise<void>((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", lines.join("; ")], {
      windowsHide: true,
    });
    let err = "";
    ps.stderr.on("data", (d) => (err += d.toString()));
    const timer = setTimeout(() => {
      ps.kill();
      reject(new Error("PowerShell не ответил за 10 с."));
    }, 10000);
    ps.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ps.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else if (code === 2) reject(new Error("Premiere Pro не запущен."));
      else reject(new Error(err.trim().split("\n")[0] || `PowerShell завершился с кодом ${code}`));
    });
  });
}
