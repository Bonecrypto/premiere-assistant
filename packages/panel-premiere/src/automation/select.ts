import { HostToolError } from "../hostTools/types.ts";
import { classify } from "./classify.ts";
import type { CategoryId, ColorRules } from "./rules.ts";
import { ppro, readTimeline } from "./timeline.ts";

/**
 * Выделяет на таймлайне все клипы категории (TrackItemSelection.createEmptySelection + Sequence.setSelection).
 * Нужно, потому что Premiere UXP API не меняет цвет у клипов на таймлайне: выделили — и пользователь одним
 * действием назначает цвет (правый клик → Label → цвет или своя горячая клавиша).
 */
export async function selectCategory(category: CategoryId, rules: ColorRules): Promise<number> {
  const data = await readTimeline();
  const items = data.clips.filter((c) => classify(c, rules).category === category).map((c) => c.trackItem);
  if (items.length === 0) return 0;

  const p = ppro() as any;
  const seq = data.sequence;
  let done = false;
  const Selection = p.TrackItemSelection;
  if (Selection && typeof Selection.createEmptySelection === "function") {
    // Колбэк синхронный: объект выделения живёт только внутри него.
    Selection.createEmptySelection((sel: any) => {
      for (const it of items) sel.addItem(it, true);
      seq.setSelection(sel);
      done = true;
    });
  }
  if (!done) {
    // Запасной путь для старых версий: снять выделение и добавить в текущее.
    if (typeof seq.clearSelection === "function") await seq.clearSelection();
    const sel = await seq.getSelection();
    for (const it of items) sel.addItem(it, true);
    await seq.setSelection(sel);
  }
  if (!items.length) throw new HostToolError("Нечего выделять.");
  return items.length;
}
