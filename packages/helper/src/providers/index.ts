import { createCompatProvider, createGeminiProvider, type ChatProvider } from "@pa/core";
import { config } from "../config.ts";
import { createClaudeProvider } from "./claude.ts";

export function createProvider(): ChatProvider {
  const settingsHint = config.envPath;
  switch (config.provider) {
    case "claude":
      return createClaudeProvider();
    case "gemini":
      return createGeminiProvider({
        apiKey: process.env.GEMINI_API_KEY,
        model: config.gemini.model,
        baseUrl: process.env.GEMINI_BASE_URL,
        maxTokens: config.maxTokens,
        settingsHint,
        apiKeyVar: "GEMINI_API_KEY",
      });
    case "ollama":
      return createCompatProvider({ kind: "ollama", ollamaUrl: config.ollama.url, ollamaModel: config.ollama.model, settingsHint });
    case "openrouter":
      return createCompatProvider({
        kind: "openrouter",
        apiKey: process.env.OPENROUTER_API_KEY,
        models: config.openrouter.models,
        settingsHint,
        apiKeyVar: "OPENROUTER_API_KEY",
      });
  }
}

/** Проверка настроек при запуске (модель скачана, список бесплатных моделей и т. п.). */
export async function checkProviderSetup(provider: ChatProvider): Promise<string | null> {
  return provider.setup ? provider.setup() : null;
}

export type { ChatProvider } from "@pa/core";
