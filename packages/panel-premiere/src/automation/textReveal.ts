import { HostToolError } from "../hostTools/types.ts";
import { wipeOn } from "../graphics/insert.ts";
import { selectedVideoItems } from "./motion.ts";

/**
 * Текстовые проявления шторкой (Linear Wipe) у выделенных клипов — для текста, титров, PNG.
 * По буквам Premiere API анимировать не даёт, поэтому «печатная машинка» — ступеньками шторки.
 */
export type TextReveal = "typewriter" | "reveal" | "reveal-up";

export const TEXT_REVEALS: Array<{ id: TextReveal; name: string; desc: string }> = [
  { id: "typewriter", name: "Печатная машинка", desc: "Текст появляется ступеньками слева направо, как при наборе" },
  { id: "reveal", name: "Проявление", desc: "Мягкая шторка слева направо" },
  { id: "reveal-up", name: "Проявление снизу", desc: "Мягкая шторка снизу вверх" },
];

export async function textReveal(id: TextReveal, seconds = 0.8): Promise<string> {
  const { items } = await selectedVideoItems();
  if (!items.length) throw new HostToolError("Выделите на таймлайне текст (или любой видеоклип).");
  let done = 0;
  for (const item of items) {
    const len = (await item.getOutPoint()).seconds - (await item.getInPoint()).seconds;
    const dur = Math.max(0.2, Math.min(id === "typewriter" ? seconds * 1.5 : seconds, len * 0.8));
    if (id === "typewriter") await wipeOn(item, { dir: "right", dur, feather: 0, steps: Math.max(6, Math.round(dur * 14)) });
    else await wipeOn(item, { dir: id === "reveal-up" ? "up" : "right", dur, feather: 40 });
    done++;
  }
  const name = TEXT_REVEALS.find((r) => r.id === id)?.name ?? id;
  return `«${name}» — ${done} клип. Отмена — Ctrl+Z несколько раз.`;
}
