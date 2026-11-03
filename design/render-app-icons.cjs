/**
 * Иконки-«приложения» для плиток (как в iOS): скруглённый квадрат с градиентом + белая иконка из design/icons.
 * Готовые PNG — потому что Premiere плохо скругляет градиентный фон у div.
 * Запуск: node design/render-app-icons.cjs → packages/panel-premiere/src/ui/appIcons.ts
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const GRADS = {
  purple: ["#c264ff", "#7a1cf0"],
  indigo: ["#8e8cff", "#4f46e5"],
  pink: ["#ff7a9a", "#ff2d55"],
  blue: ["#5ac8fa", "#0a7aff"],
  orange: ["#ffcc4d", "#ff9500"],
  green: ["#6ee38a", "#22b14c"],
};
const PAIRS = [
  ["copystyle", "purple"], ["pastestyle", "indigo"], ["nest", "purple"], ["unnest", "indigo"],
  ["scissors", "pink"], ["cutall", "pink"], ["gaps", "blue"], ["marker", "orange"], ["clock", "green"], ["eye", "indigo"],
  ["volup", "green"], ["voldown", "orange"], ["level", "blue"], ["fade", "purple"], ["duck", "pink"], ["title", "blue"], ["level", "orange"], ["camera", "green"],
];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 1 });
  const out = {};
  for (const [icon, grad] of PAIRS) {
    const svg = fs.readFileSync(path.join(__dirname, "icons", `${icon}.svg`), "utf8").replace("<svg ", '<svg width="40" height="40" ');
    const [c1, c2] = GRADS[grad];
    await p.setContent(`<html><body style="margin:0;background:transparent">
      <div id="t" style="width:72px;height:72px;border-radius:17px;background:linear-gradient(160deg,${c1},${c2});display:flex;align-items:center;justify-content:center;box-shadow:inset 0 1px 0 rgba(255,255,255,.35)">${svg}</div></body></html>`);
    out[`${icon}-${grad}`] = "data:image/png;base64," + (await p.locator("#t").screenshot({ omitBackground: true })).toString("base64");
  }
  await b.close();
  const body = Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
  const file = path.join(__dirname, "..", "packages", "panel-premiere", "src", "ui", "appIcons.ts");
  fs.writeFileSync(file, `/** Иконки-«приложения» для плиток (сгенерировано: node design/render-app-icons.cjs). Ключ — «иконка-цвет». */\nexport const APP_ICONS: Record<string, string> = {\n${body}\n};\n`);
  console.log(`${Object.keys(out).length} иконок → ${file}`);
})();
