import { storageGet } from "../env.ts";

/** Версия этой сборки панели (на GitHub — из номера сборки, локально — из package.json). */
export const APP_VERSION: string = __APP_VERSION__;

/** Репозиторий с обновлениями «владелец/имя»: задаётся при сборке на GitHub или вручную в настройках. */
export function updateRepo(): string {
  return (storageGet("updateRepo") || __UPDATE_REPO__ || "").trim();
}

/** Сравнение версий вида 0.2.15: >0 — a новее. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
