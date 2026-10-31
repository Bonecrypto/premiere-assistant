import { config } from "../config.ts";
import { createClaudeProvider } from "./claude.ts";
import { createGeminiProvider } from "./gemini.ts";
import { checkCompatSetup, createOllamaProvider, createOpenRouterProvider } from "./openaiCompat.ts";
import type { ChatProvider } from "./types.ts";

export function createProvider(): ChatProvider {
  switch (config.provider) {
    case "claude":
      return createClaudeProvider();
    case "gemini":
      return createGeminiProvider();
    case "ollama":
      return createOllamaProvider();
    case "openrouter":
      return createOpenRouterProvider();
  }
}

/** Проверка настроек при запуске (модель скачана, список бесплатных моделей и т. п.). */
export async function checkProviderSetup(provider: ChatProvider): Promise<string | null> {
  if (provider.id === "ollama" || provider.id === "openrouter") return checkCompatSetup(provider);
  return null;
}

export type { ChatProvider } from "./types.ts";
