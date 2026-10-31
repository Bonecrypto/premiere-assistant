import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * Сборка по образцу официального sample Adobe (premiere-api): один CommonJS-файл index.js,
 * модули хоста ("premierepro", "uxp") не бандлятся — их даёт UXP через require().
 * public/ (manifest.json, index.html, styles.css, иконки) копируется в dist как есть.
 * В UXP Developer Tool загружайте dist/manifest.json.
 */
export default defineConfig({
  publicDir: "public",
  base: "./",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    target: "es2020",
    rolldownOptions: {
      input: resolve(here, "src/main.tsx"),
      external: ["premierepro", "uxp", "os", "fs"],
      output: {
        format: "cjs",
        entryFileNames: "index.js",
        codeSplitting: false,
      },
    },
  },
  server: { port: 5173, open: "/dev.html" },
});
