/**
 * Графические элементы вкладки «Элементы» (стрелки, подчёркивания, обводки, значки).
 * Рисуются в Chromium (canvas) белым, сохраняются как маски прозрачности (8 бит, deflate) —
 * панель сама красит их в нужный цвет и поворачивает. Плюс превью для плиток.
 * Запуск: node design/render-graphics.cjs [папка-для-просмотра]
 * Выход: packages/panel-premiere/src/graphics/masks.ts
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { chromium } = require("playwright");

const drawAll = () => {
  const out = [];
  // ── помощники ──
  const bez = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
  };
  /** Мазок кистью: штампы кругов вдоль кривой, ширина w(t). */
  const brush = (ctx, pts, w, steps = 600) => {
    ctx.fillStyle = "#fff";
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const [x, y] = pts(t);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.6, w(t) / 2), 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const line = (a, b) => (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const curve = (p0, p1, p2, p3) => (t) => bez(p0, p1, p2, p3, t);
  const taper = (a, b, c = a) => (t) => (t < 0.5 ? a + (b - a) * (t / 0.5) : b + (c - b) * ((t - 0.5) / 0.5));
  const rr = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  const add = (id, w, h, draw) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    draw(ctx, w, h);
    // обрезать по содержимому + поля
    const d = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (d[(y * w + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    const pad = 8;
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad);
    y1 = Math.min(h - 1, y1 + pad);
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;
    const a = new Array(cw * ch);
    const img = ctx.getImageData(x0, y0, cw, ch).data;
    for (let i = 0; i < cw * ch; i++) a[i] = img[i * 4 + 3];
    // превью: белым на тёмном, 184×104
    const t = document.createElement("canvas");
    t.width = 184;
    t.height = 104;
    const tc = t.getContext("2d");
    const g = tc.createLinearGradient(0, 0, 0, 104);
    g.addColorStop(0, "#26222f");
    g.addColorStop(1, "#15131b");
    tc.fillStyle = g;
    tc.fillRect(0, 0, 184, 104);
    const k = Math.min(150 / cw, 76 / ch, 1);
    tc.drawImage(c, x0, y0, cw, ch, (184 - cw * k) / 2, (104 - ch * k) / 2, cw * k, ch * k);
    out.push({ id, w: cw, h: ch, alpha: a, thumb: t.toDataURL("image/jpeg", 0.82) });
  };

  // ── Стрелки (смотрят вправо; панель поворачивает) ──
  add("arrow-brush", 900, 360, (ctx) => {
    brush(ctx, curve([60, 230], [300, 150], [560, 140], [800, 190]), taper(46, 40, 34));
    brush(ctx, curve([800, 190], [760, 160], [730, 130], [700, 100]), taper(34, 32, 28), 200);
    brush(ctx, curve([800, 190], [760, 205], [720, 220], [680, 245]), taper(34, 32, 28), 200);
  });
  add("arrow-flat", 900, 400, (ctx) => {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(60, 160);
    ctx.lineTo(560, 160);
    ctx.lineTo(560, 60);
    ctx.lineTo(840, 200);
    ctx.lineTo(560, 340);
    ctx.lineTo(560, 240);
    ctx.lineTo(60, 240);
    ctx.closePath();
    ctx.fill();
  });
  add("arrow-thin", 900, 300, (ctx) => {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(60, 150);
    ctx.lineTo(820, 150);
    ctx.moveTo(730, 80);
    ctx.lineTo(825, 150);
    ctx.lineTo(730, 220);
    ctx.stroke();
  });
  add("arrow-curve", 760, 600, (ctx) => {
    brush(ctx, curve([60, 120], [380, 40], [620, 200], [600, 470]), taper(22, 26, 22));
    brush(ctx, line([600, 470], [530, 400]), () => 22, 120);
    brush(ctx, line([600, 470], [660, 390]), () => 22, 120);
  });
  add("arrow-loop", 1000, 520, (ctx) => {
    // линия → петля (полный круг) → линия
    const R = 95;
    const pts = (t) => {
      const u = Math.min(1, Math.max(0, (t - 0.38) / 0.26));
      const base = [60 + 860 * t, 330 - 40 * Math.sin(Math.PI * t)];
      if (u <= 0 || u >= 1) return base;
      const ang = u * Math.PI * 2;
      return [base[0] + R * Math.sin(ang) * 1.25, base[1] - R * (1 - Math.cos(ang))];
    };
    brush(ctx, pts, () => 18, 1600);
    const [ex, ey] = pts(1);
    const [px, py] = pts(0.97);
    const a = Math.atan2(ey - py, ex - px);
    for (const da of [2.5, -2.5]) brush(ctx, line([ex, ey], [ex + Math.cos(a + da) * 80, ey + Math.sin(a + da) * 80]), () => 18, 120);
  });
  // ── Линии ──
  add("underline-brush", 1000, 160, (ctx) => {
    brush(ctx, curve([40, 92], [300, 70], [650, 66], [960, 74]), (t) => 30 * Math.pow(1 - t, 0.8) + 3, 900);
  });
  add("underline-double", 1000, 200, (ctx) => {
    brush(ctx, curve([40, 70], [300, 60], [650, 58], [960, 64]), taper(14, 18, 8), 700);
    brush(ctx, curve([90, 120], [330, 112], [640, 108], [900, 116]), taper(12, 16, 6), 700);
  });
  add("underline-wave", 1000, 160, (ctx) => {
    brush(ctx, (t) => [40 + 920 * t, 80 + 26 * Math.sin(t * Math.PI * 7)], () => 14, 1200);
  });
  add("highlighter", 1000, 200, (ctx) => {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(40, 70);
    for (let x = 40; x <= 960; x += 20) ctx.lineTo(x, 62 + Math.sin(x * 0.07) * 4);
    for (let x = 960; x >= 40; x -= 20) ctx.lineTo(x, 138 + Math.cos(x * 0.05) * 4);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  add("strike", 1000, 160, (ctx) => {
    brush(ctx, curve([40, 96], [300, 80], [650, 70], [960, 60]), taper(16, 22, 12), 800);
  });

  // ── Выделение ──
  add("circle-hand", 820, 520, (ctx) => {
    const cx = 410, cy = 260;
    brush(ctx, (t) => {
      const a = -0.6 + t * Math.PI * 2.18;
      const r = 1 + 0.05 * Math.sin(t * 9);
      return [cx + Math.cos(a) * 360 * r, cy + Math.sin(a) * 200 * r - t * 22];
    }, taper(8, 18, 6), 1400);
  });
  add("box-round", 900, 500, (ctx) => {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 16;
    rr(ctx, 40, 40, 820, 420, 60);
    ctx.stroke();
  });
  add("brackets", 900, 500, (ctx) => {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 18;
    const L = 110;
    for (const [x, y, sx, sy] of [
      [40, 40, 1, 1],
      [860, 40, -1, 1],
      [40, 460, 1, -1],
      [860, 460, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * L);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * L, y);
      ctx.stroke();
    }
  });
  add("cross", 420, 420, (ctx) => {
    brush(ctx, curve([60, 70], [160, 170], [260, 260], [360, 360]), taper(34, 40, 28), 400);
    brush(ctx, curve([360, 60], [260, 170], [170, 260], [60, 360]), taper(34, 40, 28), 400);
  });
  add("check", 460, 400, (ctx) => {
    brush(ctx, curve([50, 210], [90, 250], [130, 300], [170, 340]), taper(30, 38, 40), 300);
    brush(ctx, curve([170, 340], [240, 220], [320, 120], [410, 50]), taper(40, 34, 22), 400);
  });

  // ── Значки ──
  add("sparkle", 400, 400, (ctx) => {
    ctx.fillStyle = "#fff";
    const star = (cx, cy, R, r) => {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 - Math.PI / 2;
        const rad = i % 2 ? r : R;
        ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      }
      ctx.closePath();
      ctx.fill();
    };
    star(180, 200, 150, 34);
    star(320, 90, 60, 14);
  });
  add("burst", 440, 400, (ctx) => {
    for (const [a, len] of [
      [-2.4, 110],
      [-1.75, 130],
      [-1.1, 110],
    ]) {
      const cx = 220, cy = 330;
      brush(ctx, line([cx + Math.cos(a) * 120, cy + Math.sin(a) * 120], [cx + Math.cos(a) * (120 + len), cy + Math.sin(a) * (120 + len)]), taper(30, 26, 18), 200);
    }
  });
  add("cursor", 300, 420, (ctx) => {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(40, 30);
    ctx.lineTo(40, 330);
    ctx.lineTo(115, 262);
    ctx.lineTo(170, 385);
    ctx.lineTo(222, 362);
    ctx.lineTo(168, 242);
    ctx.lineTo(265, 236);
    ctx.closePath();
    ctx.fill();
  });
  add("dot", 220, 220, (ctx) => {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(110, 110, 90, 0, Math.PI * 2);
    ctx.fill();
  });
  add("exclaim", 220, 460, (ctx) => {
    brush(ctx, line([110, 50], [110, 300]), taper(64, 56, 44), 300);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(110, 390, 34, 0, Math.PI * 2);
    ctx.fill();
  });

  // ── Плашки ──
  add("plate", 1000, 260, (ctx) => {
    ctx.fillStyle = "#fff";
    rr(ctx, 30, 30, 940, 200, 36);
    ctx.fill();
  });
  add("plate-pill", 900, 220, (ctx) => {
    ctx.fillStyle = "#fff";
    rr(ctx, 30, 30, 840, 160, 80);
    ctx.fill();
  });
  add("plate-brush", 1100, 300, (ctx) => {
    brush(ctx, curve([90, 150], [400, 136], [700, 140], [1010, 150]), (t) => 150 + 20 * Math.sin(t * 14) * (t > 0.85 || t < 0.1 ? 1 : 0.2), 1500);
  });
  add("plate-line", 1000, 120, (ctx) => {
    ctx.fillStyle = "#fff";
    ctx.fillRect(40, 40, 920, 26);
  });
  return out;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<html><body></body></html>");
  const items = await page.evaluate(`(${drawAll.toString()})()`);
  await browser.close();
  const view = process.argv[2];
  if (view) fs.mkdirSync(view, { recursive: true });
  const lines = [];
  let total = 0;
  for (const it of items) {
    const raw = Buffer.from(it.alpha);
    const z = zlib.deflateRawSync(raw, { level: 9 }).toString("base64");
    total += z.length + it.thumb.length;
    lines.push(`  ${JSON.stringify(it.id)}: { w: ${it.w}, h: ${it.h}, z: ${JSON.stringify(z)}, thumb: ${JSON.stringify(it.thumb)} },`);
    if (view) fs.writeFileSync(path.join(view, `${it.id}.jpg`), Buffer.from(it.thumb.split(",")[1], "base64"));
  }
  const ts =
    `/**\n * Маски графических элементов (сгенерировано: node design/render-graphics.cjs — не править руками).\n` +
    ` * z — прозрачность 8 бит (w×h), сжатая deflate, base64; thumb — превью для плитки.\n */\n` +
    `export const GRAPHIC_MASKS: Record<string, { w: number; h: number; z: string; thumb: string }> = {\n${lines.join("\n")}\n};\n`;
  const outFile = path.join(__dirname, "..", "packages", "panel-premiere", "src", "graphics", "masks.ts");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, ts);
  console.log(`${items.length} элементов, ${Math.round(total / 1024)} КБ → ${outFile}`);
})();
