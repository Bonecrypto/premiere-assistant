/** Где запущена панель: внутри UXP (Premiere) или в обычном браузере для отладки UI. */
declare const require: ((id: string) => any) | undefined;

function tryRequire<T = any>(id: string): T | null {
  try {
    return typeof require === "function" ? (require(id) as T) : null;
  } catch {
    return null;
  }
}

export const uxp = tryRequire<typeof import("uxp")>("uxp");

/** Панель запущена на Mac (программа в трее пока только для Windows). */
export function isMac(): boolean {
  const os = tryRequire<any>("os");
  const pl = String(os?.platform?.() ?? "").toLowerCase();
  if (pl) return pl === "darwin";
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");
}
export const isUXP = uxp !== null;

/** Модуль Premiere DOM API или null (в браузере). */
export function getPremiere(): import("@adobe/premierepro").premierepro | null {
  return tryRequire("premierepro");
}

export function hostInfo(): { name: string; version?: string } {
  if (uxp?.host) return { name: uxp.host.name, version: uxp.host.version };
  return { name: "browser" };
}

export function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* хранилище недоступно — не страшно */
  }
}
