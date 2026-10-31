import type { HostTool } from "./types.ts";

/**
 * Все host-инструменты подхватываются автоматически: каждый файл вида "premiere.имя.ts"
 * в этой папке экспортирует по умолчанию HostTool. Новый файл = новая возможность.
 */
const modules = import.meta.glob<{ default: HostTool }>("./*.*.ts", { eager: true });

export const hostTools: HostTool[] = Object.values(modules)
  .map((m) => m.default)
  .filter((t): t is HostTool => Boolean(t?.spec?.name && typeof t.run === "function"));

const byName = new Map(hostTools.map((t) => [t.spec.name, t]));

export function getHostTool(name: string): HostTool | undefined {
  return byName.get(name);
}
