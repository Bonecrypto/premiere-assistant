import Anthropic from "@anthropic-ai/sdk";
import { fromApiToolName, toApiToolName, type ToolDef } from "@pa/core";
import { config } from "../config.ts";
import type { ChatProvider, Conversation, StepResult, ToolCallResult } from "./types.ts";

type MessageParam = Anthropic.Beta.BetaMessageParam;

/** Claude через Anthropic API (платно, оплата по факту использования). */
export function createClaudeProvider(): ChatProvider {
  const client = new Anthropic();
  const model = config.claude.model;

  return {
    id: "claude",
    title: "Claude",
    model,
    apiKeyConfigured: config.claude.apiKeyConfigured,
    apiKeyVar: "ANTHROPIC_API_KEY",
    createConversation: (systemPrompt) => new ClaudeConversation(client, model, systemPrompt),
    isAbort: (err) => err instanceof Anthropic.APIUserAbortError,
    describeError,
  };

  function describeError(err: unknown): string {
    if (err instanceof Anthropic.AuthenticationError) return "Неверный API-ключ (ANTHROPIC_API_KEY). Проверьте .env помощника.";
    if (err instanceof Anthropic.PermissionDeniedError) return "Нет доступа к модели с этим ключом. Проверьте CLAUDE_MODEL и права ключа.";
    if (err instanceof Anthropic.NotFoundError) return `Модель "${model}" не найдена. Проверьте CLAUDE_MODEL в .env.`;
    if (err instanceof Anthropic.RateLimitError) return "Превышен лимит запросов к API. Подождите немного и повторите.";
    if (err instanceof Anthropic.BadRequestError) {
      if (/credit balance/i.test(err.message)) return "На балансе Anthropic закончились деньги. Пополните его на platform.claude.com → Billing.";
      return `API отклонил запрос: ${err.message}`;
    }
    if (err instanceof Anthropic.APIConnectionError) return "Нет связи с Anthropic API. Проверьте интернет/прокси.";
    if (err instanceof Anthropic.APIError) return `Ошибка API (${err.status ?? "?"}): ${err.message}`;
    return `Внутренняя ошибка помощника: ${(err as Error)?.message || String(err)}`;
  }
}

class ClaudeConversation implements Conversation {
  private history: MessageParam[] = [];

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly systemPrompt: string,
  ) {}

  addUserText(text: string): void {
    this.history.push({ role: "user", content: text });
  }

  async step(tools: ToolDef[], onText: (delta: string) => void, signal: AbortSignal): Promise<StepResult> {
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: config.maxTokens,
        system: this.systemPrompt,
        // Автоматическое кеширование стабильного префикса (инструменты + системный промпт + история).
        cache_control: { type: "ephemeral" },
        tools: tools.map((t) => ({
          name: toApiToolName(t.name),
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
        })),
        messages: this.history,
        ...(config.claude.effort ? { output_config: { effort: config.claude.effort } } : {}),
        ...(config.claude.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal },
    );
    stream.on("text", onText);
    const message = await stream.finalMessage();

    // Отказ мог оборвать ответ на середине — в историю его не добавляем (Session откатит ход).
    if (message.stop_reason === "refusal") return { stop: "refusal", toolCalls: [] };

    this.history.push({ role: "assistant", content: message.content });
    const toolCalls = message.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: fromApiToolName(b.name), input: b.input }));

    if (message.stop_reason === "pause_turn") return { stop: "continue", toolCalls: [] };
    if (message.stop_reason === "max_tokens") return { stop: "max_tokens", toolCalls };
    if (message.stop_reason === "tool_use" && toolCalls.length > 0) return { stop: "tool_calls", toolCalls };
    return { stop: "done", toolCalls: [] };
  }

  addToolResults(results: ToolCallResult[]): void {
    // Все результаты — одним сообщением.
    this.history.push({
      role: "user",
      content: results.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.call.id,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    });
  }

  checkpoint(): number {
    return this.history.length;
  }

  rollback(to: number): void {
    this.history.length = to;
  }

  reset(): void {
    this.history = [];
  }
}
