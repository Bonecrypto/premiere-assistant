// Цветные иконки для навигации в стиле «тонированных плиток» (как в Ethena OS): обводка нужного цвета.
// UXP не перекрашивает картинки CSS-фильтрами, поэтому каждая пара «иконка-цвет» — готовый PNG (data URI в коде,
// чтобы приходило с автообновлением без переустановки .ccx). Запуск: node design/render-tint-icons.cjs
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const SRC = path.join(__dirname, "icons");
const OUT = path.join(__dirname, "..", "packages", "panel-premiere", "src", "ui", "tintIcons.ts");
const SIZE = 40;

const TONES = {
  cyan: "#38bdf8",
  pink: "#f472b6",
  blue: "#7c95ff",
  violet: "#a78bfa",
  green: "#34d399",
  orange: "#fbbf24",
  teal: "#2dd4bf",
  gray: "#a1a1aa",
  red: "#fb7185",
};

/** Какие иконки каким цветом нужны (навигация и списки). */
const PAIRS = [
  ["star", "cyan"],
  ["graph", "blue"],
  ["sparkle", "pink"],
  ["shapes", "violet"],
  ["scissors", "green"],
  ["chat", "orange"],
  ["tasks", "teal"],
  ["settings", "gray"],
  ["search", "gray"],
  ["more", "gray"],
  ["bolt", "orange"],
  ["drop", "pink"],
  ["title", "violet"],
  ["speaker", "green"],
  ["presets", "blue"],
  ["eye", "red"],
  ["save", "teal"],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  const out = {};
  for (const [name, tone] of PAIRS) {
    const svg = fs
      .readFileSync(path.join(SRC, `${name}.svg`), "utf8")
      .replace(/#fff(fff)?\b/gi, TONES[tone])
      .replace("<svg ", `<svg width="${SIZE}" height="${SIZE}" `);
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    const buf = await page.locator("svg").screenshot({ omitBackground: true });
    out[`${name}-${tone}`] = "data:image/png;base64," + buf.toString("base64");
  }
  await browser.close();
  const lines = Object.entries(out).map(([k, v]) => `  "${k}": "${v}",`);
  fs.writeFileSync(
    OUT,
    `// Сгенерировано design/render-tint-icons.cjs — не править руками.\nexport const TONE_COLORS: Record<string, string> = ${JSON.stringify(TONES)};\nexport const TINT_ICONS: Record<string, string> = {\n${lines.join("\n")}\n};\n`,
  );
  console.log(Object.keys(out).length, "иконок →", OUT, fs.statSync(OUT).size, "байт");
})();
