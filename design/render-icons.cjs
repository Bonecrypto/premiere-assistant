// Рендер иконок интерфейса из design/icons/*.svg в PNG (UXP показывает SVG-картинки на чёрном фоне).
// Запуск (нужен Playwright с Chromium): node design/render-icons.cjs
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const SRC = path.join(__dirname, "icons");
const OUT = path.join(__dirname, "..", "packages", "panel-premiere", "public", "icons", "ui");
const SIZE = 48; // 2× от 24 px

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith(".svg"))) {
    const svg = fs.readFileSync(path.join(SRC, file), "utf8").replace("<svg ", `<svg width="${SIZE}" height="${SIZE}" `);
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.locator("svg").screenshot({ path: path.join(OUT, file.replace(".svg", ".png")), omitBackground: true });
  }
  await browser.close();
  console.log("Готово:", OUT);
})();
