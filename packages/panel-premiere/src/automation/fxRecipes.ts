import { HostToolError } from "../hostTools/types.ts";
import { selectedVideoItems } from "./motion.ts";
import { ppro } from "./timeline.ts";

/**
 * «Пачки» эффектов из стандартных эффектов Premiere (вкладки «Эффекты» и «Цвет»).
 * Эффект ищем по видимому названию (английский и русский интерфейс) через VideoFilterFactory.getDisplayNames/getMatchNames,
 * или по известному matchName. Параметр — по названию (displayName), иначе по номеру.
 * Если эффекта/параметра нет в этой версии Premiere — пропускаем и честно сообщаем.
 * Значения: number | boolean. strength (0…1) масштабирует отклонение числа от «нейтрального» значения.
 */

export interface ParamSet {
  /** Названия параметра (en/ru), без учёта регистра. */
  names: string[];
  index?: number;
  /** Число, флаг или цвет "#rrggbb". */
  value: number | boolean | string;
  /** Нейтральное значение — для ползунка «Сила». */
  neutral?: number;
}

export interface EffectStep {
  label: string;
  /** Возможные matchName (точное совпадение). */
  match?: string[];
  /** Видимые названия (en/ru), без учёта регистра. */
  names: string[];
  params: ParamSet[];
}

export interface FxRecipe {
  id: string;
  name: string;
  group: string;
  desc: string;
  steps: EffectStep[];
}

export interface RecipeResult {
  clips: number;
  applied: string[];
  missing: string[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");

let catalog: { match: string[]; display: string[] } | null = null;

async function effectCatalog(): Promise<{ match: string[]; display: string[] }> {
  if (catalog) return catalog;
  const f = (ppro() as any).VideoFilterFactory;
  const match: string[] = (await f.getMatchNames()) ?? [];
  let display: string[] = [];
  try {
    display = (await f.getDisplayNames()) ?? [];
  } catch {
    /* без видимых названий — только matchName */
  }
  catalog = { match, display: display.length === match.length ? display : [] };
  return catalog;
}

/** matchName эффекта шага или null. */
export async function resolveEffect(step: EffectStep): Promise<string | null> {
  const c = await effectCatalog();
  for (const m of step.match ?? []) if (c.match.includes(m)) return m;
  const want = step.names.map(norm);
  const i = c.display.findIndex((d) => want.includes(norm(d)));
  if (i >= 0) return c.match[i];
  return null;
}

function findParam(comp: any, p: ParamSet): any | null {
  const n: number = comp.getParamCount();
  const want = p.names.map(norm);
  for (let i = 0; i < n; i++) {
    const prm = comp.getParam(i);
    if (want.includes(norm(String(prm?.displayName ?? "")))) return prm;
  }
  return typeof p.index === "number" && p.index < n ? comp.getParam(p.index) : null;
}

async function findComponent(item: any, matchName: string): Promise<any | null> {
  const chain = await item.getComponentChain();
  for (let i = chain.getComponentCount() - 1; i >= 0; i--) {
    const comp = chain.getComponentAtIndex(i);
    if ((await comp.getMatchName()) === matchName) return comp;
  }
  return null;
}

function run(project: any, title: string, fill: (c: any) => void): void {
  let ok = false;
  let error: unknown = null;
  project.lockedAccess(() => {
    try {
      ok = project.executeTransaction(fill, title);
    } catch (err) {
      error = err;
    }
  });
  if (error) throw new HostToolError(`Premiere не дал выполнить «${title}»: ${(error as Error)?.message ?? error}`);
  if (!ok) throw new HostToolError(`Premiere отклонил «${title}».`);
}

/**
 * Применить пачку к выделенным видеоклипам. reuse — не добавлять эффект второй раз, если он уже есть (Lumetri),
 * а перенастроить существующий.
 */
export async function applyRecipe(recipe: FxRecipe, strength = 1, reuse = true): Promise<RecipeResult> {
  const p = ppro() as any;
  const { project, items } = await selectedVideoItems();
  const res: RecipeResult = { clips: items.length, applied: [], missing: [] };

  const resolved: Array<{ step: EffectStep; match: string }> = [];
  for (const step of recipe.steps) {
    const m = await resolveEffect(step);
    if (m) resolved.push({ step, match: m });
    else res.missing.push(`эффект «${step.label}»`);
  }
  if (!resolved.length) throw new HostToolError(`В этой версии Premiere не нашёл эффекты для «${recipe.name}».`);

  // 1. Добавить недостающие эффекты.
  const appends: Array<{ chain: any; component: any }> = [];
  for (const item of items) {
    for (const r of resolved) {
      if (reuse && (await findComponent(item, r.match))) continue;
      appends.push({ chain: await item.getComponentChain(), component: await p.VideoFilterFactory.createComponent(r.match) });
    }
  }
  if (appends.length) {
    run(project, `Ассистент: ${recipe.name} — эффекты`, (c) => {
      for (const a of appends) c.addAction(a.chain.createAppendComponentAction(a.component));
    });
  }

  // 2. Настроить параметры.
  const sets: Array<{ param: any; value: unknown }> = [];
  const missingParams = new Set<string>();
  for (const item of items) {
    for (const r of resolved) {
      const comp = await findComponent(item, r.match);
      if (!comp) continue;
      for (const ps of r.step.params) {
        const prm = findParam(comp, ps);
        if (!prm) {
          missingParams.add(`${r.step.label}: ${ps.names[0]}`);
          continue;
        }
        let v: unknown = ps.value;
        if (typeof v === "number" && typeof ps.neutral === "number") v = ps.neutral + (v - ps.neutral) * strength;
        if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) {
          // Цвет: Premiere ждёт Color с каналами 0…1.
          const n = parseInt(v.slice(1), 16);
          if (typeof p.Color !== "function") continue;
          v = new p.Color(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1);
        }
        sets.push({ param: prm, value: v });
      }
    }
  }
  if (sets.length) {
    run(project, `Ассистент: ${recipe.name}`, (c) => {
      for (const s of sets) {
        try {
          c.addAction(s.param.createSetValueAction(s.param.createKeyframe(s.value), true));
        } catch {
          /* параметр другого типа — пропускаем */
        }
      }
    });
  }
  res.applied = resolved.map((r) => r.step.label);
  res.missing.push(...[...missingParams].map((m) => `параметр «${m}»`));
  return res;
}

/** Список видимых названий эффектов этой версии Premiere — для диагностики. */
export async function listEffectNames(): Promise<string[]> {
  const c = await effectCatalog();
  return c.display.length ? c.display : c.match;
}
