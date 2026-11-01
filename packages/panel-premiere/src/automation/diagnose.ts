import { classify } from "./classify.ts";
import { labelIndexFromKey, labelTable } from "./timeline.ts";
import { loadRules } from "./rules.ts";
import { ppro, readTimeline } from "./timeline.ts";

/**
 * Диагностика цветов: какие номера меток отдаёт этот Premiere (Constants.ProjectItemColorLabel)
 * и какой номер стоит у каждого файла секвенции. Нужна, чтобы проверить сопоставление цветов.
 */
export async function diagnoseLabels(): Promise<string> {
  const p = ppro() as any;
  const consts = p.Constants?.ProjectItemColorLabel ?? {};
  const lines: string[] = [];
  const pairs = Object.keys(consts)
    .filter((k) => isNaN(Number(k)))
    .map((k) => `${k}=${consts[k]}`);
  lines.push(`Constants.ProjectItemColorLabel: ${pairs.join(", ") || "(пусто)"}`);
  lines.push(labelTable().corrected ? "Таблица цветов: исправленная (16 меток Premiere, с Caribbean)" : "Таблица цветов: из API");

  const data = await readTimeline();
  const rules = loadRules();
  const seen = new Set<string>();
  lines.push(`Секвенция «${data.sequenceName}», клипов: ${data.clips.length}`);
  for (const c of data.clips) {
    if (!c.projectItem || !c.projectItemId || seen.has(c.projectItemId)) continue;
    seen.add(c.projectItemId);
    let raw: number | string = "?";
    try {
      raw = await c.projectItem.getColorLabelIndex();
    } catch (err) {
      raw = `ошибка: ${(err as Error).message}`;
    }
    const cat = classify(c, rules).category;
    const target = rules.categories.find((x) => x.id === cat)!.label;
    let targetIdx: number | string = "?";
    try {
      targetIdx = labelIndexFromKey(target);
    } catch {
      /* нет такого цвета */
    }
    const name = c.clipName || c.mediaPath.split(/[\\/]/).pop() || "?";
    lines.push(`${name} — сейчас №${raw}; категория ${cat} → ${target} (№${targetIdx})`);
    if (seen.size >= 25) {
      lines.push("…");
      break;
    }
  }
  return lines.join("\n");
}
