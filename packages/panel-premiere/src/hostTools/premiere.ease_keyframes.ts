import { applyQuickEase, bakeCurve, unbakeCurve, type QuickEase } from "../automation/graph.ts";
import { CURVE_PRESETS, findCurvePreset, type Curve } from "../presets/curves.ts";
import { HostToolError, type HostTool } from "./types.ts";

interface Input {
  preset?: string;
  bezier?: number[];
  scope?: "all" | "motion";
  step?: 0 | 1 | 2;
  remove?: boolean;
  quick?: QuickEase;
}

/** Своя кривая плавности для ключевых кадров выделенных клипов (вкладка «Графики»). */
const tool: HostTool<Input> = {
  spec: {
    name: "premiere.ease_keyframes",
    description:
      "quick (БЕЗ новых ключей, предпочтительно для простых просьб): linear | bezier | hold — " +
      "просто меняет тип интерполяции существующих ключей выделенных клипов, как в меню ключа в Effect Controls. " +
      "Иначе — точная кривая: меняет плавность (график скорости) ключевых кадров у ВЫДЕЛЕННЫХ клипов: между каждой парой ключей ставит ключи на каждом кадре " +
      "по кривой (cubic-bezier), т.к. Premiere API не даёт двигать ручки Безье. preset — готовая кривая: " +
      CURVE_PRESETS.map((p) => `${p.id} (${p.name})`).join(", ") +
      ". Для «быстрый вылет» — preset fast-launch, для «трамплин» — trampoline (пик скорости, +3–6 ключей). Или bezier: [x1, y1, x2, y2] как в CSS. scope: all — все анимированные параметры, motion — только позиция/масштаб/поворот/прозрачность. " +
      "step: 0 (по умолчанию) — мало ключей с Bezier, выглядит естественно; 1 — ключ каждый кадр (точно), 2 — через кадр. remove: true — убрать ранее применённый график (вернуть исходные ключи с Bezier).",
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string" },
        bezier: { type: "array", items: { type: "number" } },
        scope: { type: "string", enum: ["all", "motion"] },
        step: { type: "number", enum: [0, 1, 2] },
        remove: { type: "boolean" },
        quick: { type: "string", enum: ["linear", "bezier", "hold"] },
      },
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Изменить плавность ключевых кадров выделенных клипов (детали — в «Параметрах»). Отмена — Ctrl+Z.",
  },
  async run(input) {
    if (input.remove) return unbakeCurve();
    if (input.quick) return applyQuickEase(input.quick, input.scope ?? "all");
    let curve: Curve | null = null;
    if (input.bezier && input.bezier.length === 4) curve = input.bezier.map(Number) as Curve;
    else if (input.preset) curve = findCurvePreset(input.preset);
    if (!curve) throw new HostToolError(input.preset ? `Нет кривой «${input.preset}».` : "Укажи preset или bezier.");
    if (curve[0] < 0 || curve[0] > 1 || curve[2] < 0 || curve[2] > 1) throw new HostToolError("x1 и x2 должны быть от 0 до 1.");
    const id = (input.preset ?? "").trim().toLowerCase();
    // «Быстрый вылет» / «Трамплин» — пик скорости на старте/в конце: ключи через 1, 2, 4, 8… кадров (как во вкладке «Эффекты»).
    const shape = !input.step && !input.bezier ? (id === "fast-launch" || id === "быстрый вылет" ? "launch" : id === "trampoline" || id === "трамплин" ? "trampoline" : undefined) : undefined;
    return bakeCurve(curve, { scope: input.scope ?? "all", step: input.step === 1 ? 1 : input.step === 2 ? 2 : 0, shape });
  },
};

export default tool;
