import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_HELPER_PORT } from "@pa/core";

/** Папка пакета helper (где лежит .env). */
export const HELPER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Корень монорепозитория. */
export const REPO_ROOT = path.resolve(HELPER_DIR, "..", "..");

const envPath = path.join(HELPER_DIR, ".env");
const envExamplePath = path.join(HELPER_DIR, ".env.example");
/** .env создан только что из .env.example (первый запуск). */
export const envCreated = !fs.existsSync(envPath) && fs.existsSync(envExamplePath);
if (envCreated) fs.copyFileSync(envExamplePath, envPath);
if (fs.existsSync(envPath)) {
  // Встроено в Node ≥ 20.12, отдельная зависимость не нужна.
  process.loadEnvFile(envPath);
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

function readEffort(): Effort | undefined {
  const v = process.env.CLAUDE_EFFORT?.trim().toLowerCase();
  if (!v) return undefined;
  if ((EFFORTS as readonly string[]).includes(v)) return v as Effort;
  console.warn(`⚠ CLAUDE_EFFORT="${v}" не распознан, используется значение модели по умолчанию.`);
  return undefined;
}

function readPort(): number {
  const raw = process.env.HELPER_PORT?.trim();
  if (!raw) return DEFAULT_HELPER_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.warn(`⚠ HELPER_PORT="${raw}" некорректен, используется ${DEFAULT_HELPER_PORT}.`);
    return DEFAULT_HELPER_PORT;
  }
  return n;
}

export const config = {
  envFileFound: fs.existsSync(envPath),
  envPath,
  apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
  model: process.env.CLAUDE_MODEL?.trim() ?? "",
  effort: readEffort(),
  fallbacks: (process.env.CLAUDE_FALLBACKS?.trim().toLowerCase() ?? "default") !== "off",
  port: readPort(),
  allowedOrigins: (process.env.HELPER_ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  knowledgeDir: path.join(REPO_ROOT, "knowledge"),
  maxTokens: 32000,
  /** Сколько раз подряд модель может вызвать инструменты в одном ответе. */
  maxAgentSteps: 25,
  hostToolTimeoutMs: 120_000,
};

export const HELPER_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(HELPER_DIR, "package.json"), "utf8"),
).version;
