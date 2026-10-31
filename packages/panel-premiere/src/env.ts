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
