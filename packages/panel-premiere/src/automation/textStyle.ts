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
const TEXT_KEY = /^(text|textEditValue|mText|mTextString|string|content|sourceText|mStr)$/i;

function toValue(raw: any): Value | null {
  const v = raw?.value?.value ?? raw?.value ?? raw;
  if (typeof v === "number" && Number.isFinite(v)) return { t: "num", v };
  if (typeof v === "boolean") return { t: "bool", v };
  if (typeof v === "string") return { t: "str", v };
  if (v && typeof v.x === "number" && typeof v.y === "number") return { t: "point", x: v.x, y: v.y };
  // Position / Anchor Point приходят массивом [x, y].
  if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number")) return { t: "point", x: v[0], y: v[1] };
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

/** JSON внутри строки (бывает со служебными байтами до и после). */
function embedded(s: string): { pre: string; obj: Record<string, unknown>; post: string } | null {
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const o = JSON.parse(s.slice(a, b + 1));
    return o && typeof o === "object" && !Array.isArray(o) ? { pre: s.slice(0, a), obj: o, post: s.slice(b + 1) } : null;
  } catch {
    return null;
  }
}

function asJson(s: string): Record<string, unknown> | null {
  return embedded(s)?.obj ?? null;
}

/** Стиль из source, текст из target — на любой глубине (текст бывает вложен: {mTextParam: {mText, mStyleSheet…}}). */
function mergeText(source: unknown, target: unknown): unknown {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(source) || !isObj(target)) return source;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    if (TEXT_KEY.test(k) && k in target) out[k] = target[k];
    // Длины «кусков» стиля привязаны к длине текста слоя — их тоже берём у слоя.
    else if (/run|length|count|range|index/i.test(k) && k in target) out[k] = target[k];
    else if (k in target) out[k] = mergeText(v, target[k]);
    else out[k] = v;
  }
  // Поля с текстом, которых у образца нет, — оставить как у слоя.
  for (const [k, v] of Object.entries(target)) if (TEXT_KEY.test(k) && !(k in out)) out[k] = v;
  return out;
}

/** Если перед JSON 4 служебных символа — это может быть его длина: пересчитать под новый JSON. */
function fixPrefix(pre: string, oldJson: string, newJson: string): string {
  if (pre.length !== 4) return pre;
  const codes = [...pre].map((c) => c.charCodeAt(0) & 255);
  const be = ((codes[0] << 24) | (codes[1] << 16) | (codes[2] << 8) | codes[3]) >>> 0;
  const le = ((codes[3] << 24) | (codes[2] << 16) | (codes[1] << 8) | codes[0]) >>> 0;
  const n = newJson.length;
  const enc = (b: number[]) => String.fromCharCode(...b);
  if (be === oldJson.length) return enc([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  if (le === oldJson.length) return enc([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  return pre;
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

/** Как выглядят «текстовые» и непонятные параметры образца — чтобы доделать перенос шрифта. */
export let lastDiag = "";

function describe(v: unknown): string {
  if (v === null || v === undefined) return "пусто";
  if (typeof v === "string") return `строка (${v.length}) «${v.slice(0, 160).replace(/\s+/g, " ")}»`;
  if (typeof v !== "object") return `${typeof v} ${String(v)}`;
  let keys: string[] = [];
  try {
    keys = Object.keys(v as object);
    let proto = Object.getPrototypeOf(v);
    for (let d = 0; proto && d < 3; d++, proto = Object.getPrototypeOf(proto)) keys.push(...Object.getOwnPropertyNames(proto).filter((k) => k !== "constructor"));
  } catch {
    /* без ключей */
  }
  let json = "";
  try {
    json = JSON.stringify(v).slice(0, 160);
  } catch {
    json = "";
  }
  return `объект {${[...new Set(keys)].slice(0, 20).join(", ")}} ${json}`;
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
  const diag: string[] = [];
  for (const { comp, match, nth } of await components(item)) {
    if (!match) continue;
    const params: CopiedParam[] = [];
    for (let j = 0; j < comp.getParamCount(); j++) {
      const prm = comp.getParam(j);
      if (!prm || prm.isTimeVarying?.()) continue;
      try {
        let raw = await prm.getStartValue();
        const empty = (r: any) => (r?.value?.value ?? r?.value ?? r) === undefined || (r?.value?.value ?? r?.value ?? r) === null;
        if (empty(raw)) {
          // Текст: getStartValue пустой — пробуем значение в момент начала клипа.
          raw = await prm.getValueAtTime(await item.getInPoint()).catch(() => raw);
        }
        const value = toValue(raw);
        const inner = raw?.value?.value ?? raw?.value ?? raw;
        if (!value || value.t === "str") diag.push(`${String(prm.displayName ?? j)}: ${describe(inner)}`);
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
  lastDiag = diag.slice(0, 12).join("\n");
  const fontNote = textJson ? " Шрифт и оформление текста — тоже." : "";
  return `Стиль «${name}» скопирован: ${total} параметр. в ${comps.length} компонент.${fontNote} Теперь выделите другие слои → «Вставить на выделенные».`;
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
          let curRaw = await prm.getStartValue().catch(() => null);
          if ((curRaw?.value?.value ?? curRaw?.value ?? curRaw) == null) curRaw = await prm.getValueAtTime(await item.getInPoint()).catch(() => null);
          const cur = toValue(curRaw);
          const srcJson = asJson(sp.value.v);
          const curJson = cur?.t === "str" ? asJson(cur.v) : null;
          if (srcJson && curJson) {
            const e = embedded(sp.value.v)!;
            const json = JSON.stringify(mergeText(srcJson, curJson));
            value = fixPrefix(e.pre, sp.value.v.slice(e.pre.length, sp.value.v.length - e.post.length), json) + json + e.post;
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
