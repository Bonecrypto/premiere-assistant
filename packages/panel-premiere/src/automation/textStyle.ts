import { storageGet, storageSet } from "../env.ts";
import { HostToolError } from "../hostTools/types.ts";
import { ppro } from "./timeline.ts";

/**
 * «Копировать стиль» / «Вставить стиль» — как Paste Attributes, но текст каждого слоя остаётся своим.
 * Копируются постоянные значения всех параметров клипа (Motion, Opacity, Text/Graphic: Position, Scale, Rotation,
 * шрифт, размер, заливка, обводка, выравнивание… — что API отдаёт). Параметр с самим текстом (Source Text):
 *  — если его значение — JSON (как у шаблонов .mogrt), переносится всё, кроме полей с текстом;
 *  — если это просто строка, она не трогается (иначе затрётся надпись).
 * Ключевые кадры не копируются; параметры с ключами у целевого клипа пропускаются.
 */

type Value =
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "str"; v: string }
  | { t: "point"; x: number; y: number }
  | { t: "color"; r: number; g: number; b: number; a: number };

interface CopiedParam {
  i: number;
  name: string;
  value: Value;
}
interface CopiedComponent {
  match: string;
  name: string;
  /** Номер среди компонентов с тем же matchName. */
  nth: number;
  params: CopiedParam[];
}
interface CopiedStyle {
  from: string;
  components: CopiedComponent[];
}

const KEY = "copiedStyle";
/** Поля JSON, в которых лежит сам текст (их не переносим). */
const TEXT_KEY = /^(text|textEditValue|mText|string|content|value|sourceText)$/i;

function toValue(raw: any): Value | null {
  const v = raw?.value?.value ?? raw?.value ?? raw;
  if (typeof v === "number" && Number.isFinite(v)) return { t: "num", v };
  if (typeof v === "boolean") return { t: "bool", v };
  if (typeof v === "string") return { t: "str", v };
  if (v && typeof v.x === "number" && typeof v.y === "number") return { t: "point", x: v.x, y: v.y };
  if (v && typeof v.red === "number") return { t: "color", r: v.red, g: v.green, b: v.blue, a: v.alpha ?? 1 };
  return null;
}

function fromValue(p: any, v: Value): unknown {
  switch (v.t) {
    case "num":
    case "bool":
    case "str":
      return v.v;
    case "point":
      return new p.PointF(v.x, v.y);
    case "color":
      return typeof p.Color === "function" ? new p.Color(v.r, v.g, v.b, v.a) : null;
  }
}

function asJson(s: string): Record<string, unknown> | null {
  const t = s.trim();
  if (!t.startsWith("{")) return null;
  try {
    const o = JSON.parse(t);
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** Стиль из source, текст из target. */
function mergeText(source: Record<string, unknown>, target: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...source };
  for (const [k, v] of Object.entries(target)) if (TEXT_KEY.test(k)) out[k] = v;
  return out;
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

async function selectedVideo(): Promise<{ p: any; project: any; items: any[] }> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const seq = await project?.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  const sel = await seq.getSelection();
  const all: any[] = (await sel?.getTrackItems()) ?? [];
  const items = all.filter((it) => typeof it?.isAdjustmentLayer === "function");
  // По порядку на таймлайне: первый — самый ранний.
  const withStart = await Promise.all(items.map(async (it) => ({ it, s: (await it.getStartTime()).seconds as number, t: (await it.getTrackIndex?.().catch(() => 0)) as number })));
  withStart.sort((a, b) => a.s - b.s || a.t - b.t);
  return { p, project, items: withStart.map((x) => x.it) };
}

async function components(item: any): Promise<Array<{ comp: any; match: string; nth: number }>> {
  const chain = await item.getComponentChain();
  const out: Array<{ comp: any; match: string; nth: number }> = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < chain.getComponentCount(); i++) {
    const comp = chain.getComponentAtIndex(i);
    const match: string = (await comp.getMatchName()) ?? "";
    const nth = seen.get(match) ?? 0;
    seen.set(match, nth + 1);
    out.push({ comp, match, nth });
  }
  return out;
}

export function hasCopiedStyle(): string | null {
  try {
    const v = JSON.parse(storageGet(KEY) || "null") as CopiedStyle | null;
    return v?.components?.length ? v.from : null;
  } catch {
    return null;
  }
}

/** Скопировать стиль первого выделенного клипа (самого раннего на таймлайне). */
export async function copyStyle(): Promise<string> {
  const { items } = await selectedVideo();
  const item = items[0];
  if (!item) throw new HostToolError("Выделите на таймлайне текстовый слой (или клип), с которого брать стиль.");
  const name: string = (await item.getName().catch(() => "")) || "клип";
  const comps: CopiedComponent[] = [];
  let total = 0;
  let textJson = 0;
  for (const { comp, match, nth } of await components(item)) {
    if (!match) continue;
    const params: CopiedParam[] = [];
    for (let j = 0; j < comp.getParamCount(); j++) {
      const prm = comp.getParam(j);
      if (!prm || prm.isTimeVarying?.()) continue;
      try {
        const value = toValue(await prm.getStartValue());
        if (!value) continue;
        if (value.t === "str" && asJson(value.v)) textJson++;
        params.push({ i: j, name: String(prm.displayName ?? ""), value });
      } catch {
        /* группа/кнопка без значения */
      }
    }
    total += params.length;
    comps.push({ match, name: String((await comp.getDisplayName?.().catch(() => match)) || match), nth, params });
  }
  if (!total) throw new HostToolError("У клипа нет параметров, которые можно скопировать.");
  storageSet(KEY, JSON.stringify({ from: name, components: comps } satisfies CopiedStyle));
  const fontNote = textJson ? " Шрифт и оформление текста — тоже." : "";
  return `Стиль «${name}» скопирован: ${total} параметр. в ${comps.length} компонент.${fontNote} Теперь выделите другие слои → «Вставить стиль».`;
}

/** Вставить скопированный стиль на все выделенные клипы (текст каждого остаётся своим). */
export async function pasteStyle(): Promise<string> {
  let style: CopiedStyle | null = null;
  try {
    style = JSON.parse(storageGet(KEY) || "null");
  } catch {
    style = null;
  }
  if (!style?.components?.length) throw new HostToolError("Сначала «Копировать стиль» на слое-образце.");
  const { p, project, items } = await selectedVideo();
  if (!items.length) throw new HostToolError("Выделите слои, на которые вставить стиль.");

  const sets: Array<{ param: any; value: unknown }> = [];
  let changed = 0;
  let keptText = 0;
  let skipped = 0;
  for (const item of items) {
    const comps = await components(item);
    let touched = false;
    for (const src of style.components) {
      const target = comps.find((c) => c.match === src.match && c.nth === src.nth)?.comp;
      if (!target) {
        skipped += src.params.length;
        continue;
      }
      for (const sp of src.params) {
        const prm = target.getParam(sp.i);
        if (!prm || prm.isTimeVarying?.()) {
          skipped++;
          continue;
        }
        let value: unknown = fromValue(p, sp.value);
        if (sp.value.t === "str") {
          const cur = toValue(await prm.getStartValue().catch(() => null));
          const srcJson = asJson(sp.value.v);
          const curJson = cur?.t === "str" ? asJson(cur.v) : null;
          if (srcJson && curJson) {
            value = JSON.stringify(mergeText(srcJson, curJson));
          } else if (cur?.t === "str" && cur.v !== sp.value.v) {
            // Просто строка — это сама надпись: не трогаем.
            keptText++;
            continue;
          }
        }
        if (value === null || value === undefined) {
          skipped++;
          continue;
        }
        sets.push({ param: prm, value });
        touched = true;
      }
    }
    if (touched) changed++;
  }
  if (!sets.length) throw new HostToolError("Нечего вставлять: у выделенных слоёв нет таких же компонентов, как у образца.");
  let failed = 0;
  run(project, `Ассистент: стиль «${style.from}»`, (c) => {
    for (const s of sets) {
      try {
        c.addAction(s.param.createSetValueAction(s.param.createKeyframe(s.value), true));
      } catch {
        failed++;
      }
    }
  });
  const notes = [
    keptText ? "текст слоёв сохранён" : "",
    skipped + failed ? `пропущено параметров: ${skipped + failed} (с ключами или не совпали)` : "",
  ].filter(Boolean);
  return `Стиль «${style.from}» → ${changed} слой. Отмена — Ctrl+Z.${notes.length ? ` (${notes.join("; ")})` : ""}`;
}
