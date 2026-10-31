import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TOOL_NAME_RE, type ToolDef, type ToolSpec } from "@pa/core";

/**
 * Реестр инструментов. Инструменты помощника подхватываются автоматически из папки
 * src/tools: новый файл = новая возможность, ядро править не нужно.
 * Host-инструменты (выполняются в панели) регистрируются при подключении панели.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(def: ToolDef): void {
    if (!TOOL_NAME_RE.test(def.name)) {
      throw new Error(`Имя инструмента "${def.name}" должно быть вида "префикс.имя" (латиница, цифры, _)`);
    }
    if (this.tools.has(def.name)) {
      throw new Error(`Инструмент "${def.name}" уже зарегистрирован`);
    }
    if (typeof def.run !== "function" || !def.description || !def.inputSchema) {
      throw new Error(`Инструмент "${def.name}": нужны description, inputSchema и run()`);
    }
    this.tools.set(def.name, def);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  list(): ToolDef[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Копия реестра — для отдельной сессии, куда добавятся host-инструменты её панели. */
  clone(): ToolRegistry {
    const copy = new ToolRegistry();
    for (const def of this.tools.values()) copy.tools.set(def.name, def);
    return copy;
  }

  /**
   * Загружает все инструменты из папки. Каждый файл экспортирует по умолчанию ToolDef
   * (или массив ToolDef). Файлы, начинающиеся с "_", пропускаются.
   */
  async loadFromDir(dir: string): Promise<string[]> {
    const loaded: string[] = [];
    const files = fs
      .readdirSync(dir)
      .filter((f) => /\.(ts|js|mjs)$/.test(f) && !f.endsWith(".d.ts") && !f.startsWith("_"))
      .sort();
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        const mod = await import(pathToFileURL(full).href);
        const defs: ToolDef[] = Array.isArray(mod.default) ? mod.default : [mod.default];
        for (const def of defs) {
          if (def.runsIn !== "helper") {
            throw new Error(`инструмент "${def.name}" в папке помощника должен иметь runsIn: "helper"`);
          }
          this.register(def);
          loaded.push(def.name);
        }
      } catch (err) {
        console.error(`✖ Не удалось загрузить инструмент из ${file}: ${(err as Error).message}`);
      }
    }
    return loaded;
  }
}

/** Проверяет описание host-инструмента, присланное панелью. */
export function checkHostToolSpec(spec: ToolSpec): string | null {
  if (!spec || typeof spec !== "object") return "некорректное описание";
  if (!TOOL_NAME_RE.test(spec.name ?? "")) return `некорректное имя "${spec?.name}"`;
  if (spec.runsIn !== "host") return `"${spec.name}": runsIn должен быть "host"`;
  if (!spec.description) return `"${spec.name}": нет description`;
  if (!spec.inputSchema || spec.inputSchema.type !== "object") return `"${spec.name}": inputSchema должен быть объектом`;
  if (typeof spec.mutates !== "boolean") return `"${spec.name}": не указан mutates`;
  return null;
}
