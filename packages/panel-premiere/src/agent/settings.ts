import { storageGet, storageSet, uxp } from "../env.ts";

/**
 * Настройки ИИ для встроенного режима (без помощника).
 * Ключ хранится в secureStorage UXP (зашифрован учёткой Windows), остальное — в localStorage.
 */
export type AiMode = "embedded" | "helper";
export type AiProvider = "openrouter" | "gemini" | "ollama";

export interface AiSettings {
  mode: AiMode;
  provider: AiProvider;
  /** Ключ выбранного провайдера (для Ollama не нужен). */
  apiKey: string;
  /** Модель; пусто — по умолчанию (OpenRouter выберет бесплатные сам). */
  model: string;
  ollamaUrl: string;
}

const KEY = "aiSettings";
const SECRET_PREFIX = "aiKey:";

export const PROVIDER_INFO: Record<AiProvider, { title: string; keyUrl: string; keyLabel: string; needsKey: boolean }> = {
  openrouter: { title: "OpenRouter", keyUrl: "openrouter.ai → Keys", keyLabel: "Ключ OpenRouter (sk-or-…)", needsKey: true },
  gemini: { title: "Gemini", keyUrl: "aistudio.google.com → Get API key", keyLabel: "Ключ Gemini", needsKey: true },
  ollama: { title: "Ollama", keyUrl: "ollama.com — локально, без ключа", keyLabel: "", needsKey: false },
};

const DEFAULTS: AiSettings = { mode: "embedded", provider: "openrouter", apiKey: "", model: "", ollamaUrl: "http://localhost:11434" };

function secure(): any {
  return (uxp as any)?.storage?.secureStorage ?? null;
}

async function readSecret(provider: AiProvider): Promise<string> {
  const s = secure();
  if (s) {
    try {
      const bytes: Uint8Array | null = await s.getItem(SECRET_PREFIX + provider);
      if (bytes && bytes.length) return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
    } catch {
      /* нет значения */
    }
  }
  // Запасной путь (браузер для отладки): localStorage.
  return storageGet(SECRET_PREFIX + provider) ?? "";
}

async function writeSecret(provider: AiProvider, value: string): Promise<void> {
  const s = secure();
  if (s) {
    try {
      if (value) await s.setItem(SECRET_PREFIX + provider, value);
      else await s.removeItem(SECRET_PREFIX + provider).catch(() => {});
      return;
    } catch {
      /* упадём на localStorage */
    }
  }
  storageSet(SECRET_PREFIX + provider, value);
}

export async function loadAiSettings(): Promise<AiSettings> {
  let base = { ...DEFAULTS };
  try {
    const raw = storageGet(KEY);
    if (raw) base = { ...base, ...JSON.parse(raw), apiKey: "" };
  } catch {
    /* по умолчанию */
  }
  base.apiKey = await readSecret(base.provider);
  return base;
}

export async function saveAiSettings(s: AiSettings): Promise<AiSettings> {
  const { apiKey, ...rest } = s;
  storageSet(KEY, JSON.stringify(rest));
  await writeSecret(s.provider, apiKey.trim());
  return { ...s, apiKey: apiKey.trim() };
}

/** Ключ для другого провайдера (при переключении в настройках). */
export function loadKeyFor(provider: AiProvider): Promise<string> {
  return readSecret(provider);
}

export function isAiConfigured(s: AiSettings): boolean {
  return !PROVIDER_INFO[s.provider].needsKey || Boolean(s.apiKey.trim());
}
