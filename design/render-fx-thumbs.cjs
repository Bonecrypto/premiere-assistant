/**
 * Картинки плиток вкладок «Эффекты» и «Цвет»: рисуются в Chromium (canvas) и встраиваются в код
 * (packages/panel-premiere/src/ui/fxThumbs.ts, data URI JPEG) — приходят с автообновлением.
 * Запуск: node design/render-fx-thumbs.cjs   (нужен playwright с Chromium)
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const W = 184;
const H = 104;

// Код ниже выполняется в браузере.
const drawAll = (W, H) => {
  const out = {};
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c;
  };
  const rr = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  /** Базовая сцена: закат, солнце, горы, озеро, пальма. */
  const scene = (ctx, w = W, h = H) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
    sky.addColorStop(0, "#2b1b6b");
    sky.addColorStop(0.55, "#d9487a");
    sky.addColorStop(1, "#ffb36b");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ffe08a";
    ctx.beginPath();
    ctx.arc(w * 0.62, h * 0.5, h * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5a2a6e";
    ctx.beginPath();
    ctx.moveTo(0, h * 0.62);
    ctx.lineTo(w * 0.18, h * 0.36);
    ctx.lineTo(w * 0.34, h * 0.52);
    ctx.lineTo(w * 0.48, h * 0.4);
    ctx.lineTo(w * 0.7, h * 0.62);
    ctx.fill();
    ctx.fillStyle = "#3a1650";
    ctx.beginPath();
    ctx.moveTo(w * 0.45, h * 0.62);
    ctx.lineTo(w * 0.8, h * 0.3);
    ctx.lineTo(w, h * 0.48);
    ctx.lineTo(w, h * 0.62);
    ctx.fill();
    const sea = ctx.createLinearGradient(0, h * 0.62, 0, h);
    sea.addColorStop(0, "#c2508a");
    sea.addColorStop(1, "#1f1446");
    ctx.fillStyle = sea;
    ctx.fillRect(0, h * 0.62, w, h * 0.38);
    ctx.fillStyle = "rgba(255,224,138,0.75)";
    for (let i = 0; i < 6; i++) ctx.fillRect(w * 0.62 - (14 - i * 2), h * (0.66 + i * 0.05), (14 - i * 2) * 2, 1.6);
    // пальма
    ctx.strokeStyle = "#140a24";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.16, h);
    ctx.quadraticCurveTo(w * 0.2, h * 0.7, w * 0.15, h * 0.42);
    ctx.stroke();
    ctx.fillStyle = "#140a24";
    for (const a of [-2.6, -2.0, -1.2, -0.5, 0.2]) {
      ctx.save();
      ctx.translate(w * 0.15, h * 0.42);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(13, 0, 14, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  const withFilter = (filter, extra) => {
    const c = mk();
    const ctx = c.getContext("2d");
    ctx.filter = filter;
    scene(ctx);
    ctx.filter = "none";
    extra && extra(ctx);
    return c;
  };
  const noise = (ctx, amt, alpha = 0.25) => {
    const d = ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < d.data.length; i += 4) {
      const n = (Math.random() - 0.5) * amt;
      d.data[i] += n;
      d.data[i + 1] += n;
      d.data[i + 2] += n;
    }
    ctx.putImageData(d, 0, 0);
  };
  const vignette = (ctx, k = 0.75) => {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${k})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  const tone = (ctx, color, mode = "soft-light", a = 0.55) => {
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = a;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  };
  const label = (ctx, text, x, y, color = "rgba(255,255,255,0.9)", size = 11) => {
    ctx.font = `600 ${size}px "Segoe UI", Inter, Arial, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  const dark = (ctx, top = "#1c1a24", bottom = "#0e0d13") => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  /** Маленькая картинка-«PNG» (сцена в рамке) — для углов и свечения по контуру. */
  const card = (ctx, x, y, w, h, r) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    scene(c.getContext("2d"), w, h);
    ctx.save();
    rr(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.drawImage(c, x, y);
    ctx.restore();
  };

  // ── Стиль / картинка ──
  out["soft-bg"] = withFilter("blur(5px)", (ctx) => label(ctx, "Заголовок", 52, 58, "#fff", 15));
  out["dream"] = withFilter("blur(1.6px) brightness(1.18) saturate(1.3)", (ctx) => tone(ctx, "#fff0ff", "screen", 0.25));
  out["bw-contrast"] = withFilter("grayscale(1) contrast(1.55)");
  out["vhs"] = (() => {
    const c = mk();
    const ctx = c.getContext("2d");
    ctx.filter = "saturate(0.7) contrast(0.9)";
    scene(ctx);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.35;
    ctx.drawImage(c, 3, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    for (let y = 0; y < H; y += 3) {
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, y, W, 1);
    }
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(0, H * 0.72, W, 2);
    noise(ctx, 50);
    label(ctx, "▶ PLAY", 8, 16, "#e8ffe8", 11);
    return c;
  })();
  out["film"] = withFilter("sepia(0.55) contrast(1.15) saturate(0.85)", (ctx) => {
    vignette(ctx, 0.8);
    noise(ctx, 40);
  });
  out["sharpen"] = (() => {
    const c = mk();
    const ctx = c.getContext("2d");
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W / 2, H);
    ctx.clip();
    ctx.filter = "blur(1.5px)";
    scene(ctx);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(W / 2, 0, W / 2, H);
    ctx.clip();
    ctx.filter = "contrast(1.35) saturate(1.15)";
    scene(ctx);
    ctx.restore();
    ctx.filter = "none";
    ctx.fillStyle = "#fff";
    ctx.fillRect(W / 2 - 1, 0, 2, H);
    return c;
  })();
  out["pixel"] = (() => {
    const s = document.createElement("canvas");
    s.width = 23;
    s.height = 13;
    const sctx = s.getContext("2d");
    sctx.drawImage(withFilter("none"), 0, 0, 23, 13);
    const c = mk();
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(s, 0, 0, W, H);
    return c;
  })();
  out["stop-motion"] = (() => {
    const c = mk();
    const ctx = c.getContext("2d");
    scene(ctx);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = 0.35 + i * 0.2;
      ctx.fillStyle = "#ffffff";
      rr(ctx, 22 + i * 38, 54 - i * 8, 24, 24, 6);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    label(ctx, "12 к/с", 8, 16);
    return c;
  })();
  out["invert"] = withFilter("invert(1)");

  // ── Углы ──
  const round = (r) => {
    const c = mk();
    const ctx = c.getContext("2d");
    dark(ctx);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    for (let x = 0; x < W; x += 12) for (let y = 0; y < H; y += 12) if ((x + y) % 24 === 0) ctx.fillRect(x, y, 12, 12);
    card(ctx, 32, 14, 120, 76, r);
    return c;
  };
  out["round-s"] = round(6);
  out["round-m"] = round(16);
  out["round-l"] = round(34);

  // ── Свечение ──
  const glowScene = (radius, power) => {
    const c = mk();
    const ctx = c.getContext("2d");
    scene(ctx);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, W, H);
    const b = mk();
    const bctx = b.getContext("2d");
    bctx.filter = `brightness(1.4) contrast(2.2) blur(${radius}px)`;
    scene(bctx);
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < power; i++) ctx.drawImage(b, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    return c;
  };
  out["glow-soft"] = glowScene(4, 1);
  out["glow-strong"] = glowScene(9, 2);
  const alphaGlow = (size, color) => {
    const c = mk();
    const ctx = c.getContext("2d");
    dark(ctx, "#15121e", "#07060a");
    ctx.save();
    ctx.shadowColor = color;
    for (let i = 0; i < 3; i++) {
      ctx.shadowBlur = size * (i + 1) * 0.7;
      ctx.font = '800 34px "Segoe UI", Inter, Arial, sans-serif';
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText("GLOW", W / 2, H / 2 + 12);
    }
    ctx.restore();
    return c;
  };
  out["glow-alpha"] = alphaGlow(8, "#ffffff");
  out["glow-neon"] = alphaGlow(16, "#c04bff");

  // ── Движение ──
  out["transform-mb"] = (() => {
    const c = mk();
    const ctx = c.getContext("2d");
    dark(ctx);
    for (let i = 0; i < 14; i++) {
      ctx.globalAlpha = 0.06 + (i / 14) * 0.2;
      card(ctx, 18 + i * 5, 26, 70, 52, 8);
    }
    ctx.globalAlpha = 1;
    card(ctx, 92, 26, 70, 52, 8);
    label(ctx, "360°", 8, 16, "#c9a6ff");
    return c;
  })();
  const motion = (draw) => {
    const c = mk();
    const ctx = c.getContext("2d");
    dark(ctx);
    draw(ctx);
    return c;
  };
  out["shake"] = motion((ctx) => {
    for (const [dx, dy, a] of [
      [-5, 2, 0.25],
      [4, -3, 0.35],
      [0, 0, 1],
    ]) {
      ctx.globalAlpha = a;
      card(ctx, 42 + dx, 18 + dy, 100, 66, 8);
    }
    ctx.globalAlpha = 1;
  });
  out["shake-hard"] = motion((ctx) => {
    for (const [dx, dy, a] of [
      [-12, 5, 0.22],
      [11, -7, 0.3],
      [-6, -4, 0.4],
      [0, 0, 1],
    ]) {
      ctx.globalAlpha = a;
      card(ctx, 42 + dx, 18 + dy, 100, 66, 8);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 2;
    for (const [x, y] of [
      [20, 20],
      [164, 84],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x + 6, y);
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x, y + 6);
      ctx.stroke();
    }
  });
  const zoomFrames = (ctx, sizes, color) => {
    ctx.strokeStyle = color;
    sizes.forEach((s, i) => {
      ctx.globalAlpha = 0.35 + (i / sizes.length) * 0.65;
      ctx.lineWidth = 1.5;
      rr(ctx, W / 2 - (s * 1.6) / 2, H / 2 - s / 2, s * 1.6, s, 6);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  };
  out["punch"] = motion((ctx) => {
    card(ctx, 22, 6, 140, 92, 8);
    zoomFrames(ctx, [40, 58, 76], "#ffffff");
  });
  out["pop"] = motion((ctx) => {
    ctx.fillStyle = "#9f18ec";
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    card(ctx, W / 2 - 36, H / 2 - 24, 72, 48, 10);
    ctx.strokeStyle = "#e6c6ff";
    ctx.lineWidth = 1.5;
    rr(ctx, W / 2 - 44, H / 2 - 30, 88, 60, 12);
    ctx.stroke();
  });
  out["push"] = motion((ctx) => {
    card(ctx, 12, 8, 160, 88, 8);
    zoomFrames(ctx, [50, 62, 74, 86], "rgba(255,255,255,0.9)");
  });

  // ── Ключи: график скорости ──
  const speed = (fn, opt = {}) => {
    const c = mk();
    const ctx = c.getContext("2d");
    dark(ctx, "#1a1724", "#121019");
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let x = 12; x < W; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.lineTo(x, H - 12);
      ctx.stroke();
    }
    const x0 = 14;
    const x1 = W - 14;
    const y0 = H - 16;
    const y1 = 14;
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      pts.push([x0 + (x1 - x0) * t, y0 - (y0 - y1) * fn(t)]);
    }
    const g = ctx.createLinearGradient(0, y1, 0, y0);
    g.addColorStop(0, "rgba(159,24,236,0.55)");
    g.addColorStop(1, "rgba(159,24,236,0.05)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(x1, y0);
    ctx.fill();
    ctx.strokeStyle = opt.color || "#c77dff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    // ключи
    const keys = opt.keys || [0, 1];
    ctx.fillStyle = "#ffffff";
    for (const k of keys) {
      const x = x0 + (x1 - x0) * k;
      ctx.save();
      ctx.translate(x, y0 + 7);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    }
    for (const k of opt.extra || []) {
      const x = x0 + (x1 - x0) * k;
      ctx.save();
      ctx.translate(x, y0 + 7);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#ff5e9a";
      ctx.fillRect(-2.5, -2.5, 5, 5);
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.stroke();
    opt.after && opt.after(ctx);
    label(ctx, opt.tag || "скорость", 8, 13, "rgba(255,255,255,0.45)", 9);
    return c;
  };
  out["launch"] = speed((t) => Math.pow(1 - t, 1.6));
  out["trampoline"] = speed((t) => Math.pow(t, 1.6));
  out["smooth"] = speed((t) => Math.sin(Math.PI * t) * 0.9);
  out["fast-launch"] = speed((t) => Math.pow(1 - t, 5), { extra: [0.06, 0.14, 0.3] });
  out["trampoline-exact"] = speed((t) => Math.pow(t, 5), { extra: [0.7, 0.86, 0.94] });
  out["unbake"] = speed((t) => Math.sin(Math.PI * t) * 0.9, {
    extra: [0.25, 0.5, 0.75],
    after: (ctx) => {
      ctx.strokeStyle = "#ff5e9a";
      ctx.lineWidth = 1.5;
      for (const k of [0.25, 0.5, 0.75]) {
        const x = 14 + (W - 28) * k;
        ctx.beginPath();
        ctx.moveTo(x - 5, H - 14);
        ctx.lineTo(x + 5, H - 4);
        ctx.moveTo(x + 5, H - 14);
        ctx.lineTo(x - 5, H - 4);
        ctx.stroke();
      }
    },
  });

  // ── Создать: мини-таймлайн, новый элемент подсвечен ──
  const timeline = (fill, name, textColor) => {
    const c = mk();
    const ctx = c.getContext("2d");
    dark(ctx, "#1d1b25", "#141219");
    const rows = [
      [12, "V3"],
      [36, "V2"],
      [60, "V1"],
      [84, "A1"],
    ];
    ctx.font = '600 9px "Segoe UI", Inter, Arial, sans-serif';
    for (const [y, n] of rows) {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(22, y, W - 26, 18);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillText(n, 5, y + 12);
    }
    // V1 — видео, A1 — звук
    ctx.fillStyle = "#4b6fe0";
    rr(ctx, 24, 61, 70, 16, 3);
    ctx.fill();
    rr(ctx, 96, 61, 80, 16, 3);
    ctx.fill();
    ctx.fillStyle = "#2fa66b";
    rr(ctx, 24, 85, 152, 16, 3);
    ctx.fill();
    // новый элемент на V2
    ctx.save();
    ctx.shadowColor = "rgba(199,125,255,0.9)";
    ctx.shadowBlur = 8;
    if (typeof fill === "function") fill(ctx, 70, 37, 80, 16);
    else {
      ctx.fillStyle = fill;
      rr(ctx, 70, 37, 80, 16, 3);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = "#c77dff";
    ctx.lineWidth = 1.5;
    rr(ctx, 70, 37, 80, 16, 3);
    ctx.stroke();
    ctx.font = '700 8.5px "Segoe UI", Inter, Arial, sans-serif';
    ctx.fillStyle = textColor;
    ctx.fillText(name, 75, 48);
    // плейхед
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(70, 4);
    ctx.lineTo(70, H);
    ctx.stroke();
    ctx.fillStyle = "#ffcc00";
    ctx.beginPath();
    ctx.moveTo(65, 2);
    ctx.lineTo(75, 2);
    ctx.lineTo(70, 8);
    ctx.fill();
    return c;
  };
  out["create-black"] = timeline("#000000", "Black Video", "#ffffff");
  out["create-white"] = timeline("#ffffff", "White Matte", "#222222");
  out["create-green"] = timeline("#00b140", "Green Matte", "#ffffff");
  out["create-purple"] = timeline("#9f18ec", "Color Matte", "#ffffff");
  out["create-adjust"] = timeline(
    (ctx, x, y, w, h) => {
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, "#ff5e9a");
      g.addColorStop(0.5, "#c77dff");
      g.addColorStop(1, "#4fc3ff");
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.7;
      rr(ctx, x, y, w, h, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
    },
    "Adjustment",
    "#ffffff",
  );

  // ── Цвет (Lumetri) ──
  out["warm"] = withFilter("sepia(0.3) saturate(1.25) hue-rotate(-8deg)", (ctx) => tone(ctx, "#ff9a3c", "soft-light", 0.5));
  out["cold"] = withFilter("saturate(0.85) hue-rotate(15deg)", (ctx) => tone(ctx, "#3c7dff", "soft-light", 0.65));
  out["sunset"] = withFilter("brightness(1.08) saturate(1.2)", (ctx) => tone(ctx, "#ff6a88", "soft-light", 0.6));
  out["night"] = withFilter("brightness(0.55) saturate(0.7) hue-rotate(20deg)", (ctx) => tone(ctx, "#1e3a8a", "soft-light", 0.7));
  out["cinema"] = withFilter("contrast(1.2) saturate(0.85)", (ctx) => {
    tone(ctx, "#13b5a8", "soft-light", 0.35);
    vignette(ctx, 0.6);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, 11);
    ctx.fillRect(0, H - 11, W, 11);
  });
  out["vivid"] = withFilter("saturate(1.8) contrast(1.12)");
  out["faded"] = withFilter("contrast(0.75) saturate(0.7) brightness(1.1)", (ctx) => tone(ctx, "#cbbfae", "lighten", 0.25));
  out["bw"] = withFilter("grayscale(1) contrast(1.15)");
  out["vignette"] = withFilter("none", (ctx) => vignette(ctx, 0.95));
  out["reset"] = withFilter("none", (ctx) => {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 18, -Math.PI * 0.2, Math.PI * 1.5);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(W / 2 + 6, H / 2 - 28);
    ctx.lineTo(W / 2 + 6, H / 2 - 10);
    ctx.lineTo(W / 2 - 8, H / 2 - 19);
    ctx.fill();
  });
  // Свои пачки — общая картинка
  out["mine"] = motion((ctx) => {
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.4 + i * 0.3;
      card(ctx, 40 + i * 12, 14 + i * 10, 90, 58, 8);
    }
    ctx.globalAlpha = 1;
  });

  const res = {};
  for (const [k, c] of Object.entries(out)) res[k] = c.toDataURL("image/jpeg", 0.8);
  return res;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<html><body></body></html>");
  const thumbs = await page.evaluate(`(${drawAll.toString()})(${W}, ${H})`);
  const dir = process.argv[2];
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [k, v] of Object.entries(thumbs)) fs.writeFileSync(path.join(dir, `${k}.jpg`), Buffer.from(v.split(",")[1], "base64"));
  }
  await browser.close();
  const body = Object.entries(thumbs)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");
  const ts = `/**\n * Картинки плиток «Эффекты» / «Цвет» (сгенерировано: node design/render-fx-thumbs.cjs — не править руками).\n * Встроены в код, чтобы приходили с автообновлением.\n */\nexport const FX_THUMBS: Record<string, string> = {\n${body}\n};\n`;
  const outFile = path.join(__dirname, "..", "packages", "panel-premiere", "src", "ui", "fxThumbs.ts");
  fs.writeFileSync(outFile, ts);
  console.log(`${Object.keys(thumbs).length} картинок, ${Math.round(ts.length / 1024)} КБ → ${outFile}`);
})();
