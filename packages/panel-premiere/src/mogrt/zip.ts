/**
 * Минимальное чтение ZIP (.mogrt — это zip): оглавление + распаковка Deflate.
 * Нужно только чтобы достать превью (thumb.png) и definition.json — без сторонних библиотек.
 */

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

export function listZip(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Конец центрального каталога: сигнатура 0x06054b50, ищем с конца.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Файл не похож на .mogrt (zip).");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function readZipEntry(buf: Uint8Array, e: ZipEntry): Uint8Array {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(e.offset, true) !== 0x04034b50) throw new Error("Повреждённый zip.");
  const nameLen = dv.getUint16(e.offset + 26, true);
  const extraLen = dv.getUint16(e.offset + 28, true);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data;
  if (e.method === 8) return inflate(data, e.size);
  throw new Error(`Сжатие ${e.method} не поддерживается.`);
}

// ───────── Inflate (RFC 1951), компактная реализация по мотивам tinf ─────────

class Tree {
  table = new Uint16Array(16);
  trans = new Uint16Array(288);
}

const LEN_BITS = new Uint8Array(30);
const LEN_BASE = new Uint16Array(30);
const DIST_BITS = new Uint8Array(30);
const DIST_BASE = new Uint16Array(30);
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function buildBase(bits: Uint8Array, base: Uint16Array, delta: number, first: number) {
  for (let i = 0; i < delta; i++) bits[i] = 0;
  for (let i = 0; i < 30 - delta; i++) bits[i + delta] = (i / delta) | 0;
  for (let sum = first, i = 0; i < 30; i++) {
    base[i] = sum;
    sum += 1 << bits[i];
  }
}
buildBase(LEN_BITS, LEN_BASE, 4, 3);
buildBase(DIST_BITS, DIST_BASE, 2, 1);
LEN_BITS[28] = 0;
LEN_BASE[28] = 258;

function buildTree(t: Tree, lengths: Uint8Array, off: number, num: number) {
  const offs = new Uint16Array(16);
  t.table.fill(0);
  for (let i = 0; i < num; i++) t.table[lengths[off + i]]++;
  t.table[0] = 0;
  for (let sum = 0, i = 0; i < 16; i++) {
    offs[i] = sum;
    sum += t.table[i];
  }
  for (let i = 0; i < num; i++) if (lengths[off + i]) t.trans[offs[lengths[off + i]]++] = i;
}

const FIXED_L = new Tree();
const FIXED_D = new Tree();
(() => {
  FIXED_L.table.fill(0);
  FIXED_L.table[7] = 24;
  FIXED_L.table[8] = 152;
  FIXED_L.table[9] = 112;
  for (let i = 0; i < 24; i++) FIXED_L.trans[i] = 256 + i;
  for (let i = 0; i < 144; i++) FIXED_L.trans[24 + i] = i;
  for (let i = 0; i < 8; i++) FIXED_L.trans[24 + 144 + i] = 280 + i;
  for (let i = 0; i < 112; i++) FIXED_L.trans[24 + 144 + 8 + i] = 144 + i;
  FIXED_D.table.fill(0);
  FIXED_D.table[5] = 32;
  for (let i = 0; i < 32; i++) FIXED_D.trans[i] = i;
})();

export function inflate(src: Uint8Array, sizeHint = 0): Uint8Array {
  let out = new Uint8Array(Math.max(1024, sizeHint));
  let outLen = 0;
  let pos = 0;
  let tag = 0;
  let bitcount = 0;

  const ensure = (n: number) => {
    if (outLen + n <= out.length) return;
    const next = new Uint8Array(Math.max(out.length * 2, outLen + n));
    next.set(out.subarray(0, outLen));
    out = next;
  };
  const getbit = () => {
    if (!bitcount--) {
      tag = src[pos++];
      bitcount = 7;
    }
    const b = tag & 1;
    tag >>>= 1;
    return b;
  };
  const readbits = (num: number, base: number) => {
    if (!num) return base;
    let val = 0;
    for (let i = 0; i < num; i++) val |= getbit() << i;
    return val + base;
  };
  const decodeSym = (t: Tree) => {
    let sum = 0;
    let cur = 0;
    let len = 0;
    do {
      cur = 2 * cur + getbit();
      len++;
      sum += t.table[len];
      cur -= t.table[len];
    } while (cur >= 0);
    return t.trans[sum + cur];
  };
  const decodeTrees = (lt: Tree, dt: Tree) => {
    const lengths = new Uint8Array(288 + 32);
    const hlit = readbits(5, 257);
    const hdist = readbits(5, 1);
    const hclen = readbits(4, 4);
    for (let i = 0; i < hclen; i++) lengths[CLEN_ORDER[i]] = readbits(3, 0);
    const codeTree = new Tree();
    buildTree(codeTree, lengths, 0, 19);
    for (let num = 0; num < hlit + hdist; ) {
      const sym = decodeSym(codeTree);
      if (sym === 16) {
        const prev = lengths[num - 1];
        for (let l = readbits(2, 3); l; l--) lengths[num++] = prev;
      } else if (sym === 17) {
        for (let l = readbits(3, 3); l; l--) lengths[num++] = 0;
      } else if (sym === 18) {
        for (let l = readbits(7, 11); l; l--) lengths[num++] = 0;
      } else lengths[num++] = sym;
    }
    buildTree(lt, lengths, 0, hlit);
    buildTree(dt, lengths, hlit, hdist);
  };
  const block = (lt: Tree, dt: Tree) => {
    for (;;) {
      const sym = decodeSym(lt);
      if (sym === 256) return;
      if (sym < 256) {
        ensure(1);
        out[outLen++] = sym;
      } else {
        const s = sym - 257;
        const length = readbits(LEN_BITS[s], LEN_BASE[s]);
        const d = decodeSym(dt);
        const offs = outLen - readbits(DIST_BITS[d], DIST_BASE[d]);
        ensure(length);
        for (let i = offs; i < offs + length; i++) out[outLen++] = out[i];
      }
    }
  };

  let final = 0;
  do {
    final = getbit();
    const type = readbits(2, 0);
    if (type === 0) {
      bitcount = 0;
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      ensure(len);
      out.set(src.subarray(pos, pos + len), outLen);
      outLen += len;
      pos += len;
    } else if (type === 1) block(FIXED_L, FIXED_D);
    else if (type === 2) {
      const lt = new Tree();
      const dt = new Tree();
      decodeTrees(lt, dt);
      block(lt, dt);
    } else throw new Error("Повреждённые данные Deflate.");
  } while (!final);
  return out.subarray(0, outLen);
}
