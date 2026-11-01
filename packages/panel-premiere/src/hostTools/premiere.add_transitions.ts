import { addTransitions, type TransitionKind } from "../automation/transitions.ts";
import type { HostTool } from "./types.ts";

const tool: HostTool<{ kind?: TransitionKind; seconds?: number; edges?: boolean }> = {
  spec: {
    name: "premiere.add_transitions",
    description:
      "Добавляет видеопереходы на все стыки ВЫДЕЛЕННЫХ клипов (где конец клипа совпадает с началом следующего на той же " +
      "дорожке). kind: dissolve — Cross Dissolve (по умолчанию), black — Dip to Black, white — Dip to White, film — Film " +
      "Dissolve. seconds — длительность (по умолчанию 0.5). edges — ещё в начале первого и конце последнего клипа. " +
      "Если ничего не выделено — попроси выделить (Ctrl+A на таймлайне). Один Ctrl+Z.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["dissolve", "black", "white", "film"] },
        seconds: { type: "number", minimum: 0.04, maximum: 10 },
        edges: { type: "boolean" },
      },
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Добавить переходы на стыки выделенных клипов (какие — в «Параметрах»). Отменяется одним Ctrl+Z.",
  },
  run: (i) => addTransitions({ kind: i.kind ?? "dissolve", seconds: i.seconds ?? 0.5, edges: Boolean(i.edges) }),
};

export default tool;
