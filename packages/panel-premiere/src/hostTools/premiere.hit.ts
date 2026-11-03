import { applyHit, HITS } from "../automation/hits.ts";
import type { HostTool } from "./types.ts";

/** «Удары» — короткие акценты на бит у выделенных клипов. */
const tool: HostTool<{ id: string }> = {
  spec: {
    name: "premiere.hit",
    description:
      "Короткий акцент на бит у ВЫДЕЛЕННЫХ видеоклипов от плейхеда (3–8 кадров ключей): " +
      HITS.map((h) => `${h.id} (${h.name}: ${h.desc})`).join("; ") +
      ". Для нескольких битов — вызывать по одному, переставляя плейхед, или предложить пользователю «Авто → Маркеры».",
    inputSchema: { type: "object", properties: { id: { type: "string", enum: HITS.map((h) => h.id) } }, required: ["id"], additionalProperties: false },
    runsIn: "host",
    mutates: true,
    confirmText: "Добавить короткий акцент (ключи на 3–8 кадров) выделенным клипам от плейхеда. Отмена — Ctrl+Z.",
  },
  run(input) {
    return applyHit(input.id);
  },
};

export default tool;
