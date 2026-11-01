import { HostToolError } from "../hostTools/types.ts";
import type { AlignAnchor, SafeMargin } from "../presets/catalog.ts";
import { ppro } from "./timeline.ts";

/**
 * Быстрые действия с клипами через Effect Controls → Motion (Premiere UXP API 25.6+):
 * Sequence.getSelection → TrackItemSelection.getTrackItems → VideoClipTrackItem.getComponentChain →
 * компонент Motion → ComponentParam.createKeyframe + createSetValueAction.
 * Всё — одной транзакцией (один Ctrl+Z).
 *
 * Чего API не сообщает напрямую, определяем на месте:
 * - единицы Position/Anchor Point (доли кадра 0…1 или пиксели) — по текущему значению;
 * - размер исходника — из метаданных проекта (колонка «Video Info», например «1920 x 1080»).
 */

export type MotionOp = "fit" | "fill" | "center" | "fliph" | "flipv" | "reset" | "align";

export interface MotionRequest {
  op: MotionOp;
  anchor?: AlignAnchor;
  margin?: SafeMargin;
}

export interface MotionResult {
  changed: number;
  skipped: Array<{ name: string; why: string }>;
}

const MARGIN: Record<SafeMargin, number> = { edge: 0, action: 0.05, title: 0.1 };

const NAMES = {
  position: ["position", "положение", "позиция", "position (x, y)"],
  scale: ["scale", "масштаб"],
  rotation: ["rotation", "поворот", "вращение"],
  anchor: ["anchor point", "опорная точка", "точка привязки", "якорная точка"],
};

type AnyParam = any;

interface MotionParams {
  position: AnyParam;
  scale: AnyParam;
  rotation: AnyParam | null;
  anchor: AnyParam | null;
}

function pointOf(v: any): { x: number; y: number } | null {
  const val = v?.value?.value ?? v?.value ?? v;
  if (!val) return null;
  if (typeof val.x === "number" && typeof val.y === "number") return { x: val.x, y: val.y };
  if (Array.isArray(val) && val.length >= 2) return { x: Number(val[0]), y: Number(val[1]) };
  return null;
}

function numberOf(v: any): number | null {
  const val = v?.value?.value ?? v?.value ?? v;
  return typeof val === "number" ? val : null;
}

async function findMotion(item: any): Promise<MotionParams> {
  const chain = await item.getComponentChain();
  const count: number = chain.getComponentCount();
  const seen: string[] = [];
  for (let i = 0; i < count; i++) {
    const comp = chain.getComponentAtIndex(i);
    const match: string = (await comp.getMatchName()) ?? "";
    seen.push(match);
    if (!/motion/i.test(match)) continue;
    const params: AnyParam[] = [];
    const pc: number = comp.getParamCount();
    for (let j = 0; j < pc; j++) params.push(comp.getParam(j));
    const byName = (names: string[]) =>
      params.find((p) => names.includes(String(p.displayName ?? "").trim().toLowerCase())) ?? null;
    // По имени (английский/русский интерфейс), иначе — по стандартному порядку параметров Motion.
    const position = byName(NAMES.position) ?? params[0];
    const scale = byName(NAMES.scale) ?? params[1];
    const rotation = byName(NAMES.rotation) ?? params[4] ?? null;
    const anchor = byName(NAMES.anchor) ?? params[5] ?? null;
    if (!position || !scale) break;
    return { position, scale, rotation, anchor };
  }
  throw new HostToolError(`Не нашёл эффект Motion у клипа (эффекты: ${seen.join(", ") || "нет"}).`);
}

/** Размер исходника из метаданных проекта («Video Info: 1920 x 1080 (1,0)»). */
async function sourceSize(item: any): Promise<{ w: number; h: number } | null> {
  try {
    const projectItem = await item.getProjectItem();
    if (!projectItem) return null;
    const meta: string = await ppro().Metadata.getProjectColumnsMetadata(projectItem);
    const m = /(\d{2,5})\s*[x×]\s*(\d{2,5})/.exec(meta ?? "");
    return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
  } catch {
    return null;
  }
}

async function selectedVideoItems(): Promise<{ project: any; frame: { w: number; h: number }; items: any[] }> {
  const p = ppro();
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new HostToolError("Нет активной секвенции.");
  const rect = await sequence.getFrameSize();
  const selection = await sequence.getSelection();
  const all: any[] = (await selection?.getTrackItems()) ?? [];
  // У видеоклипов есть isAdjustmentLayer — так отличаем их от аудио.
  const items = all.filter((it) => typeof it?.isAdjustmentLayer === "function");
  if (items.length === 0) {
    throw new HostToolError(
      all.length ? "Выделены только аудиоклипы. Выделите видеоклипы на таймлайне." : "Выделите клипы на таймлайне.",
    );
  }
  return { project, frame: { w: rect.width, h: rect.height }, items };
}

/** Применяет действие к выделенным видеоклипам одной транзакцией. */
export async function applyMotion(req: MotionRequest): Promise<MotionResult> {
  if (req.op === "fliph" || req.op === "flipv") return applyFlip(req.op);

  const p = ppro();
  const { project, frame, items } = await selectedVideoItems();
  const W = frame.w;
  const H = frame.h;
  const skipped: MotionResult["skipped"] = [];
  const work: Array<{ param: AnyParam; value: number | { x: number; y: number }; normalized?: boolean }> = [];

  for (const item of items) {
    const name: string = (await item.getName().catch(() => "")) || "клип";
    let m: MotionParams;
    try {
      m = await findMotion(item);
    } catch (err) {
      skipped.push({ name, why: (err as Error).message });
      continue;
    }
    if (m.position.isTimeVarying?.() || m.scale.isTimeVarying?.()) {
      skipped.push({ name, why: "на Position/Scale есть ключевые кадры — не трогаю, чтобы не сломать анимацию" });
      continue;
    }

    const pos = pointOf(await m.position.getStartValue());
    const scalePct = numberOf(await m.scale.getStartValue()) ?? 100;
    const anchorRaw = m.anchor ? pointOf(await m.anchor.getStartValue()) : null;
    if (!pos) {
      skipped.push({ name, why: "не удалось прочитать Position" });
      continue;
    }
    // Доли кадра (0…1) или пиксели — по текущему значению.
    const posNorm = Math.abs(pos.x) <= 2 && Math.abs(pos.y) <= 2;
    const toPos = (x: number, y: number) => (posNorm ? { x: x / W, y: y / H } : { x, y });

    const src = await sourceSize(item);
    const needsSrc = req.op === "fit" || req.op === "fill" || req.op === "align";
    if (needsSrc && !src) {
      skipped.push({ name, why: "не удалось узнать размер исходника (Video Info)" });
      continue;
    }

    let scale = scalePct;
    if (req.op === "fit") scale = Math.min(W / src!.w, H / src!.h) * 100;
    if (req.op === "fill") scale = Math.max(W / src!.w, H / src!.h) * 100;
    if (req.op === "reset") scale = 100;

    // Опорная точка в пикселях исходника (по умолчанию — центр).
    let anchorPx = src ? { x: src.w / 2, y: src.h / 2 } : null;
    if (anchorRaw && src) {
      const anchorNorm = Math.abs(anchorRaw.x) <= 2 && Math.abs(anchorRaw.y) <= 2;
      anchorPx = anchorNorm ? { x: anchorRaw.x * src.w, y: anchorRaw.y * src.h } : anchorRaw;
    }

    let target: { x: number; y: number };
    if (req.op === "align" && src && anchorPx) {
      const s = scale / 100;
      const dw = src.w * s;
      const dh = src.h * s;
      const mx = W * MARGIN[req.margin ?? "action"];
      const my = H * MARGIN[req.margin ?? "action"];
      const a = req.anchor ?? "center";
      const left = a.endsWith("left") ? mx : a.endsWith("right") ? W - mx - dw : (W - dw) / 2;
      const top = a.startsWith("top") ? my : a.startsWith("bottom") ? H - my - dh : (H - dh) / 2;
      target = { x: left + anchorPx.x * s, y: top + anchorPx.y * s };
    } else {
      // По центру кадра (для fit/fill/center/reset).
      target = { x: W / 2, y: H / 2 };
      if (anchorPx && src && req.op !== "reset") {
        // Если опорная точка не в центре исходника — компенсируем, чтобы по центру был сам кадр клипа.
        const s = scale / 100;
        target = { x: W / 2 + (anchorPx.x - src.w / 2) * s, y: H / 2 + (anchorPx.y - src.h / 2) * s };
      }
    }

    work.push({ param: m.position, value: toPos(target.x, target.y) });
    if (req.op !== "center" && req.op !== "align") work.push({ param: m.scale, value: Math.round(scale * 100) / 100 });
    if (req.op === "reset") {
      if (m.rotation && !m.rotation.isTimeVarying?.()) work.push({ param: m.rotation, value: 0 });
      if (m.anchor && anchorRaw && src && !m.anchor.isTimeVarying?.()) {
        const anchorNorm = Math.abs(anchorRaw.x) <= 2 && Math.abs(anchorRaw.y) <= 2;
        work.push({ param: m.anchor, value: anchorNorm ? { x: 0.5, y: 0.5 } : { x: src.w / 2, y: src.h / 2 } });
      }
    }
  }

  if (work.length === 0) {
    const why = skipped[0]?.why ?? "нечего менять";
    throw new HostToolError(`Не применено: ${why}.`);
  }

  let ok = false;
  let error: unknown = null;
  project.lockedAccess(() => {
    try {
      ok = project.executeTransaction((compound: any) => {
        for (const w of work) {
          const v = typeof w.value === "number" ? w.value : new p.PointF(w.value.x, w.value.y);
          compound.addAction(w.param.createSetValueAction(w.param.createKeyframe(v), true));
        }
      }, `Ассистент: ${OP_TITLE[req.op]}`);
    } catch (err) {
      error = err;
    }
  });
  if (error) throw new HostToolError(`Premiere не дал изменить Motion: ${(error as Error)?.message ?? error}`);
  if (!ok) throw new HostToolError("Premiere отклонил изменение (транзакция не выполнена).");
  return { changed: items.length - skipped.length, skipped };
}

export const OP_TITLE: Record<MotionOp, string> = {
  fit: "вписать в кадр",
  fill: "заполнить кадр",
  center: "по центру",
  fliph: "отразить по горизонтали",
  flipv: "отразить по вертикали",
  reset: "сбросить Motion",
  align: "выравнивание",
};

/** Отражение — отдельным эффектом Premiere (Horizontal/Vertical Flip): имя эффекта ищем в списке API. */
async function applyFlip(op: "fliph" | "flipv"): Promise<MotionResult> {
  const p = ppro();
  const { project, items } = await selectedVideoItems();
  const names: string[] = await p.VideoFilterFactory.getMatchNames();
  const want = op === "fliph" ? /horizontal\s*flip/i : /vertical\s*flip/i;
  const matchName = names.find((n) => want.test(n));
  if (!matchName) {
    throw new HostToolError(
      "В этой версии Premiere не нашёл эффект отражения. Вручную: Effects → Transform → " +
        (op === "fliph" ? "Horizontal Flip." : "Vertical Flip."),
    );
  }
  const actions: Array<{ chain: any; component: any }> = [];
  for (const item of items) {
    const chain = await item.getComponentChain();
    const component = await p.VideoFilterFactory.createComponent(matchName);
    actions.push({ chain, component });
  }
  let ok = false;
  let error: unknown = null;
  project.lockedAccess(() => {
    try {
      ok = project.executeTransaction((compound: any) => {
        for (const a of actions) compound.addAction(a.chain.createAppendComponentAction(a.component));
      }, `Ассистент: ${OP_TITLE[op]}`);
    } catch (err) {
      error = err;
    }
  });
  if (error) throw new HostToolError(`Premiere не дал добавить эффект: ${(error as Error)?.message ?? error}`);
  if (!ok) throw new HostToolError("Premiere отклонил изменение (транзакция не выполнена).");
  return { changed: items.length, skipped: [] };
}
