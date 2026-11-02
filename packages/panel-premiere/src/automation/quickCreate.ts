import { uxp } from "../env.ts";
import { HostToolError } from "../hostTools/types.ts";
import { ppro } from "./timeline.ts";

/**
 * «Создать»: Black Video, Color Matte, Adjustment Layer — одним кликом на таймлайн.
 * Создать синтетический элемент API не умеет, поэтому:
 * — Black Video / Color Matte: панель пишет однотонный PNG в папку данных, импортирует (Project.importFiles),
 *   растягивает на кадр (ClipProjectItem.createSetScaleToFrameSizeAction) и кладёт под плейхед
 *   (SequenceEditor.createOverwriteItemAction) на свободную видеодорожку; при выделенных клипах — накрывает их по длине.
 * — Adjustment Layer: берём уже существующий корректирующий слой проекта (на таймлайне или в Project по имени).
 */

// ───────── PNG без библиотек: несжатый Deflate («stored»), CRC32, Adler32 ─────────

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function chunk(type: string, data: Uint8Array): Uint8Array[] {
  const t = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
  return [u32(data.length), t, data, u32(crc32([t, data]))];
}

/** Однотонный PNG (RGB) w×h. */
export function solidPng(w: number, h: number, r: number, g: number, b: number): Uint8Array {
  const row = 1 + w * 3;
  const raw = new Uint8Array(row * h);
  for (let y = 0; y < h; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * row + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  // zlib: заголовок + блоки stored по 65535 байт + adler32
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let i = 0; i < raw.length; i += 65535) {
    const len = Math.min(65535, raw.length - i);
    const last = i + len >= raw.length ? 1 : 0;
    blocks.push(new Uint8Array([last, len & 255, len >> 8, ~len & 255, (~len >> 8) & 255]), raw.subarray(i, i + len));
  }
  let a = 1;
  let b2 = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b2 = (b2 + a) % 65521;
  }
  blocks.push(u32(((b2 << 16) | a) >>> 0));
  const idatLen = blocks.reduce((n, p) => n + p.length, 0);
  const idat = new Uint8Array(idatLen);
  let off = 0;
  for (const p of blocks) {
    idat.set(p, off);
    off += p.length;
  }
  const ihdr = new Uint8Array([...u32(w), ...u32(h), 8, 2, 0, 0, 0]);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ...chunk("IHDR", ihdr), ...chunk("IDAT", idat), ...chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ───────── Premiere ─────────

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

async function walkItems(p: any, folder: any, out: any[]): Promise<void> {
  for (const it of (await folder.getItems()) ?? []) {
    const sub = p.FolderItem.cast(it);
    if (sub) await walkItems(p, sub, out);
    else out.push(it);
  }
}

async function findByPath(p: any, project: any, path: string): Promise<any | null> {
  const all: any[] = [];
  await walkItems(p, await project.getRootItem(), all);
  const want = path.toLowerCase().replace(/\//g, "\\");
  for (const it of all) {
    const clip = p.ClipProjectItem.cast(it);
    if (!clip) continue;
    const mp = String((await clip.getMediaFilePath().catch(() => "")) ?? "").toLowerCase().replace(/\//g, "\\");
    if (mp && mp === want) return it;
  }
  return null;
}

/** Однотонный кадр как элемент проекта (создаёт PNG и импортирует при первом использовании). */
async function solidItem(name: string, hex: string): Promise<any> {
  const p = ppro() as any;
  const u: any = uxp;
  const project = await p.Project.getActiveProject();
  if (!project) throw new HostToolError("В Premiere нет открытого проекта.");
  const data = await u.storage.localFileSystem.getDataFolder();
  let folder: any;
  try {
    folder = await data.getEntry("solids");
  } catch {
    folder = await data.createFolder("solids");
  }
  const file = `${name}.png`;
  let entry: any;
  try {
    entry = await folder.getEntry(file);
  } catch {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) ?? ["", "00", "00", "00"];
    const png = solidPng(320, 180, parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16));
    entry = await folder.createFile(file, { overwrite: true });
    await entry.write(png.buffer, { format: u.storage.formats.binary });
  }
  let item = await findByPath(p, project, entry.nativePath);
  if (!item) {
    const ok = await project.importFiles([entry.nativePath], true);
    if (!ok) throw new HostToolError("Premiere не импортировал кадр.");
    item = await findByPath(p, project, entry.nativePath);
    if (!item) throw new HostToolError("Не нашёл импортированный кадр в проекте.");
    const clip = p.ClipProjectItem.cast(item);
    try {
      run(project, "Ассистент: растянуть на кадр", (c) => c.addAction(clip.createSetScaleToFrameSizeAction()));
    } catch {
      /* не критично — PNG 16:9 */
    }
  }
  return item;
}

/** Существующий корректирующий слой проекта или null. */
async function adjustmentItem(): Promise<any | null> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const seq = await project.getActiveSequence();
  const CLIP = p.Constants?.TrackItemType?.CLIP ?? 1;
  if (seq) {
    const n: number = await seq.getVideoTrackCount();
    for (let i = 0; i < n; i++) {
      const track = await seq.getVideoTrack(i);
      for (const it of (await track?.getTrackItems(CLIP, false)) ?? []) {
        if (await it.isAdjustmentLayer?.().catch(() => false)) return it.getProjectItem();
      }
    }
  }
  const all: any[] = [];
  await walkItems(p, await project.getRootItem(), all);
  for (const it of all) {
    const name = String((await it.getName?.().catch(() => "")) ?? it.name ?? "");
    if (/adjustment layer|корректирующий слой|корректирующ/i.test(name)) return it;
  }
  return null;
}

interface Placed {
  track: number;
  start: number;
  end: number | null;
}

/** Положить элемент под плейхед (или на диапазон выделенных клипов) на свободную видеодорожку над V1. */
async function place(item: any, title: string): Promise<Placed> {
  const p = ppro() as any;
  const project = await p.Project.getActiveProject();
  const seq = await project.getActiveSequence();
  if (!seq) throw new HostToolError("Откройте секвенцию на таймлайне.");
  const sel = await seq.getSelection();
  const selected: any[] = (await sel?.getTrackItems()) ?? [];
  let start: number;
  let end: number | null = null;
  if (selected.length) {
    const starts = await Promise.all(selected.map(async (it) => (await it.getStartTime()).seconds as number));
    const ends = await Promise.all(selected.map(async (it) => (await it.getEndTime()).seconds as number));
    start = Math.min(...starts);
    end = Math.max(...ends);
  } else {
    start = (await seq.getPlayerPosition()).seconds;
  }
  const CLIP = p.Constants?.TrackItemType?.CLIP ?? 1;
  const count: number = await seq.getVideoTrackCount();
  const probeEnd = end ?? start + 5;
  let track = count;
  for (let i = 1; i < count; i++) {
    const items: any[] = (await (await seq.getVideoTrack(i))?.getTrackItems(CLIP, false)) ?? [];
    let busy = false;
    for (const it of items) {
      const s = (await it.getStartTime()).seconds;
      const e = (await it.getEndTime()).seconds;
      if (s < probeEnd - 0.001 && e > start + 0.001) {
        busy = true;
        break;
      }
    }
    if (!busy) {
      track = i;
      break;
    }
  }
  const editor = p.SequenceEditor.getEditor(seq);
  run(project, title, (c) => c.addAction(editor.createOverwriteItemAction(item, p.TickTime.createWithSeconds(start), track, -1)));
  if (end !== null) {
    // Подогнать длину под выделенные клипы.
    const t = await seq.getVideoTrack(track);
    for (const it of (await t?.getTrackItems(CLIP, false)) ?? []) {
      const s = (await it.getStartTime()).seconds;
      if (Math.abs(s - start) < 0.01) {
        try {
          run(project, `${title} — длина`, (c) => c.addAction(it.createSetEndAction(p.TickTime.createWithSeconds(end!))));
        } catch {
          /* длина по умолчанию */
        }
        break;
      }
    }
  }
  return { track, start, end };
}

const where = (r: Placed) => `V${r.track + 1}, ${r.start.toFixed(2)} с${r.end !== null ? ` — до ${r.end.toFixed(2)} с` : ""}`;

export async function blackVideo(): Promise<string> {
  const r = await place(await solidItem("Black Video", "#000000"), "Ассистент: Black Video");
  return `Black Video — на ${where(r)}. Отмена — Ctrl+Z.`;
}

export async function colorMatte(hex: string): Promise<string> {
  const clean = hex.replace("#", "").toLowerCase();
  const r = await place(await solidItem(`Color Matte ${clean}`, clean), "Ассистент: Color Matte");
  return `Color Matte #${clean} — на ${where(r)}. Цвет потом меняется только новой плашкой. Отмена — Ctrl+Z.`;
}

export async function adjustmentLayer(): Promise<string> {
  const item = await adjustmentItem();
  if (!item) {
    throw new HostToolError(
      "В проекте нет корректирующего слоя, а создать новый Premiere плагину не даёт. Создайте один раз: File → New → Adjustment Layer — дальше панель будет класть его сама.",
    );
  }
  const r = await place(item, "Ассистент: Adjustment Layer");
  return `Adjustment Layer — на ${where(r)}. Отмена — Ctrl+Z.`;
}
