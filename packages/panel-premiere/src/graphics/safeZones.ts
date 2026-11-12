import { HostToolError } from "../hostTools/types.ts";
import { dataFileItem, encodePng } from "../automation/quickCreate.ts";
import { ppro } from "../automation/timeline.ts";

/**
 * Оверлеи «безопасных зон» соцсетей: прозрачный PNG поверх всей секвенции — красным подсвечено то,
 * что закроет интерфейс (подписи, кнопки, ник). Клипы оверлеев называются «PA Safe …»: их можно
 * спрятать (выключить — в экспорт не попадут), показать и удалить одной кнопкой.
 */

type Rect = [number, number, number, number]; // x1, y1, x2, y2 в пикселях кадра

export interface SafeZone {
  id: string;
  name: string;
  note: string;
  w: number;
  h: number;
  /** Безопасные области (их объединение). Всё остальное — опасная зона. */
  safe: Rect[];
  /** Только рамки (16:9 title/action safe, сетка) — без красной заливки. */
  outlines?: Rect[];
  grid?: boolean;
  approx?: boolean;
}

export const SAFE_ZONES: SafeZone[] = [
  {
    id: "reels",
    name: "Instagram Reels",
    note: "Сверху 250, снизу 420, слева 70, справа 55 (ниже — 193 под кнопки)",
    w: 1080,
    h: 1920,
    safe: [
      [70, 250, 1025, 1110],
      [70, 1110, 887, 1500],
    ],
  },
  { id: "tiktok", name: "TikTok", note: "Примерно: сверху 160, снизу 440, справа 120 под кнопки", w: 1080, h: 1920, safe: [[60, 160, 960, 1480]], approx: true },
  { id: "shorts", name: "YouTube Shorts", note: "Примерно: сверху 180, снизу 400, справа 190 под кнопки", w: 1080, h: 1920, safe: [[70, 180, 890, 1520]], approx: true },
  { id: "all-vertical", name: "Все вертикальные", note: "Безопасно сразу для Reels, TikTok и Shorts", w: 1080, h: 1920, safe: [[70, 250, 887, 1480]] },
  {
    id: "tv-16x9",
    name: "16:9 Title / Action",
    note: "Рамки: action safe 90% и title safe 80%",
    w: 1920,
    h: 1080,
    safe: [],
    outlines: [
      [96, 54, 1824, 1026],
      [192, 108, 1728, 972],
    ],
  },
  { id: "grid-vertical", name: "Сетка 3×3 (9:16)", note: "Правило третей и центр", w: 1080, h: 1920, safe: [], grid: true },
  { id: "grid-16x9", name: "Сетка 3×3 (16:9)", note: "Правило третей и центр", w: 1920, h: 1080, safe: [], grid: true },
];

const DANGER = [255, 59, 48, 100]; // красный, ~40% непрозрачности
const SAFE_LINE = [52, 199, 89, 230]; // зелёная рамка
const GUIDE = [255, 255, 255, 170];

/** PNG оверлея (в половину размера кадра — Premiere растянет «Scale to Frame Size»). */
export function zonePng(z: SafeZone): Uint8Array {
  const k = 0.5;
  const W = Math.round(z.w * k);
  const H = Math.round(z.h * k);
  const px = new Uint8Array(W * H * 4);
  const put = (x: number, y: number, c: number[]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    px.set(c, (y * W + x) * 4);
  };
  const scaled = (r: Rect): Rect => [Math.round(r[0] * k), Math.round(r[1] * k), Math.round(r[2] * k), Math.round(r[3] * k)];
  const safe = z.safe.map(scaled);
  if (safe.length) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) if (!safe.some((r) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3])) put(x, y, DANGER);
  }
  const outline = (r: Rect, c: number[], t = 2) => {
    for (let x = r[0]; x < r[2]; x++) for (let i = 0; i < t; i++) (put(x, r[1] + i, c), put(x, r[3] - 1 - i, c));
    for (let y = r[1]; y < r[3]; y++) for (let i = 0; i < t; i++) (put(r[0] + i, y, c), put(r[2] - 1 - i, y, c));
  };
  for (const r of safe) outline(r, SAFE_LINE);
  for (const r of (z.outlines ?? []).map(scaled)) outline(r, GUIDE);
  if (z.grid) {
    for (const f of [1 / 3, 2 / 3]) {
      const gx = Math.round(W * f);
      const gy = Math.round(H * f);
      for (let y = 0; y < H; y++) (put(gx, y, GUIDE), put(gx + 1, y, GUIDE));
      for (let x = 0; x < W; x++) (put(x, gy, GUIDE), put(x, gy + 1, GUIDE));
    }
    const cx = Math.round(W / 2);
    const cy = Math.round(H / 2);
    for (let i = -12; i <= 12; i++) (put(cx + i, cy, GUIDE), put(cx, cy + i, GUIDE));
  }
  return encodePng(W, H, px, 4);
}

const PREFIX = "PA Safe";

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

async function ctx() {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const seq = await project.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  return { p, project, seq };
}

/** Положить оверлей поверх всего (верхняя свободная дорожка) на всю длину секвенции. */
export async function insertSafeZone(id: string): Promise<string> {
  const z = SAFE_ZONES.find((x) => x.id === id);
  if (!z) throw new HostToolError(`Нет оверлея «${id}».`);
  const { p, project, seq } = await ctx();
  let warn = "";
  try {
    const fr = await seq.getFrameSize?.();
    if (fr && fr.width && fr.height && fr.width > fr.height !== z.w > z.h) warn = " Внимание: формат секвенции не совпадает с оверлеем.";
  } catch {
    /* размер кадра неизвестен */
  }
  const item = await dataFileItem("overlays", `${PREFIX} ${z.name.replace(/[\\/:*?"<>|]/g, "-")}.png`, () => zonePng(z), true);
  const endS = Math.max(5, (await seq.getEndTime()).seconds || 0);
  const CLIP = p.Constants?.TrackItemType?.CLIP ?? 1;
  const count: number = await seq.getVideoTrackCount();
  const top = count > 0 ? (((await (await seq.getVideoTrack(count - 1))?.getTrackItems(CLIP, false)) ?? []) as any[]) : [];
  const track = count > 1 && top.length === 0 ? count - 1 : count;
  const editor = p.SequenceEditor.getEditor(seq);
  const T = (s: number) => p.TickTime.createWithSeconds(s);
  run(project, `Ассистент: оверлей ${z.name}`, (c) => c.addAction(editor.createOverwriteItemAction(item, T(0), track, -1)));
  const t = await seq.getVideoTrack(track);
  for (const it of (await t?.getTrackItems(CLIP, false)) ?? []) {
    if (Math.abs((await it.getStartTime()).seconds) < 0.01) {
      try {
        run(project, "Ассистент: оверлей — длина", (c) => c.addAction(it.createSetEndAction(T(endS))));
      } catch {
        /* длина по умолчанию — растяните вручную */
      }
      break;
    }
  }
  return `«${z.name}» — на V${track + 1} на всю секвенцию. Перед экспортом нажмите «Спрятать».${warn}`;
}

async function overlayClips(): Promise<{ p: any; project: any; seq: any; clips: any[] }> {
  const { p, project, seq } = await ctx();
  const CLIP = p.Constants?.TrackItemType?.CLIP ?? 1;
  const clips: any[] = [];
  const n: number = await seq.getVideoTrackCount();
  for (let i = 0; i < n; i++) {
    for (const it of (await (await seq.getVideoTrack(i))?.getTrackItems(CLIP, false)) ?? []) {
      const name = String((await it.getName?.().catch(() => "")) ?? "");
      if (name.startsWith(PREFIX)) clips.push(it);
    }
  }
  return { p, project, seq, clips };
}

/** Спрятать (выключить — в экспорт не попадут) или показать все оверлеи. */
export async function toggleSafeZones(show: boolean): Promise<string> {
  const { project, clips } = await overlayClips();
  if (!clips.length) return "Оверлеев на таймлайне нет.";
  run(project, show ? "Ассистент: показать оверлеи" : "Ассистент: спрятать оверлеи", (c) => {
    for (const it of clips) c.addAction(it.createSetDisabledAction(!show));
  });
  return show ? `Показано оверлеев: ${clips.length}.` : `Спрятано оверлеев: ${clips.length} — в экспорт не попадут.`;
}

export async function removeSafeZones(): Promise<string> {
  const { p, project, seq, clips } = await overlayClips();
  if (!clips.length) return "Оверлеев на таймлайне нет.";
  const editor = p.SequenceEditor.getEditor(seq);
  p.TrackItemSelection.createEmptySelection((sel: any) => {
    for (const it of clips) sel.addItem(it, true);
    run(project, "Ассистент: убрать оверлеи", (c) => c.addAction(editor.createRemoveItemsAction(sel, false, p.Constants.MediaType.ANY)));
  });
  return `Убрано оверлеев: ${clips.length}.`;
}
