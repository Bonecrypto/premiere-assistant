import { config } from "../config.ts";
import { createClaudeProvider } from "./claude.ts";
import { createGeminiProvider } from "./gemini.ts";
import type { ChatProvider } from "./types.ts";

export function createProvider(): ChatProvider {
  return config.provider === "claude" ? createClaudeProvider() : createGeminiProvider();
}

export type { ChatProvider } from "./types.ts";
