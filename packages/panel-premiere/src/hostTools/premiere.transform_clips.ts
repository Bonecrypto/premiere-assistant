import { applyMotion, type MotionOp } from "../automation/motion.ts";
import type { AlignAnchor, SafeMargin } from "../presets/catalog.ts";
import type { HostTool } from "./types.ts";

const OPS: MotionOp[] = ["fit", "fill", "center", "fliph", "flipv", "reset", "align"];
const ANCHORS: AlignAnchor[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];

/** Быстрые действия с выделенными клипами (Motion): вписать, заполнить, по центру, отразить, сбросить, выровнять. */
const tool: HostTool<{ op: MotionOp; anchor?: AlignAnchor; margin?: SafeMargin }> = {
  spec: {
    name: "premiere.transform_clips",
    description:
      "Меняет Effect Controls → Motion у ВЫДЕЛЕННЫХ на таймлайне видеоклипов: fit — вписать в кадр целиком, fill — заполнить " +
      "кадр, center — по центру, fliph/flipv — отразить (добавляет эффект Horizontal/Vertical Flip), reset — сбросить Motion " +
      "(позиция по центру, масштаб 100, поворот 0), align — выровнять в кадре (anchor: top-left … bottom-right, margin: " +
      "edge — по краю, action — отступ 5%, title — 10%). Клипы с ключевыми кадрами на Position/Scale пропускаются. " +
      "Если ничего не выделено — попроси пользователя выделить клипы. Отменяется одним Ctrl+Z.",
    inputSchema: {
      type: "object",
      properties: {
        op: { type: "string", enum: OPS },
        anchor: { type: "string", enum: ANCHORS },
        margin: { type: "string", enum: ["edge", "action", "title"] },
      },
      required: ["op"],
      additionalProperties: false,
    },
    runsIn: "host",
    mutates: true,
    confirmText: "Изменить Effect Controls → Motion у выделенных клипов (что именно — в «Параметрах»). Отменяется одним Ctrl+Z.",
  },
  run: (input) => applyMotion(input),
};

export default tool;
