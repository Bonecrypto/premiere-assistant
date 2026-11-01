import {
  AgentSession,
  createCompatProvider,
  createGeminiProvider,
  PROTOCOL_VERSION,
  type ChatProvider,
  type HelperToPanel,
  type PanelToHelper,
  type ToolDef,
} from "@pa/core";
import type { ConnectionStatus, Transport } from "../connection.ts";
import { hostTools } from "../hostTools/index.ts";
import { localTools } from "./localTools.ts";
import { PROVIDER_INFO, type AiSettings } from "./settings.ts";

const HINT = "Настройки → ИИ";

export function buildProvider(s: AiSettings): ChatProvider {
  switch (s.provider) {
    case "gemini":
      return createGeminiProvider({ apiKey: s.apiKey, model: s.model || undefined, settingsHint: HINT, apiKeyVar: "ключ Gemini" });
    case "ollama":
      return createCompatProvider({ kind: "ollama", ollamaUrl: s.ollamaUrl, ollamaModel: s.model || undefined, settingsHint: HINT });
    case "openrouter":
    default:
      return createCompatProvider({
        kind: "openrouter",
        apiKey: s.apiKey,
        models: s.model ? s.model.split(",").map((m) => m.trim()).filter(Boolean) : [],
        settingsHint: HINT,
        apiKeyVar: "ключ OpenRouter",
      });
  }
}

/** Host-инструменты панели в виде ToolDef: во встроенном режиме они вызываются напрямую. */
function panelTools(): ToolDef[] {
  const fromHost: ToolDef[] = hostTools.map((t) => ({
    ...t.spec,
    describe: t.spec.confirmText ? () => t.spec.confirmText! : undefined,
    run: (input: unknown) => t.run(input),
  }));
  return [...fromHost, ...localTools];
}

/**
 * Встроенный режим: ИИ работает прямо из панели, без отдельной программы-помощника.
 * Для интерфейса выглядит как подключение к помощнику — тот же протокол сообщений.
 */
export class EmbeddedTransport implements Transport {
  status: ConnectionStatus = "disconnected";
  private agent: AgentSession | null = null;
  private generation = 0;

  constructor(
    private readonly settings: AiSettings,
    private readonly onMessage: (msg: HelperToPanel) => void,
    private readonly onStatus: (status: ConnectionStatus) => void,
  ) {}

  start(): void {
    const gen = ++this.generation;
    this.setStatus("connecting");
    void this.init(gen);
  }

  stop(): void {
    this.generation++;
    this.agent?.dispose();
    this.agent = null;
    this.status = "disconnected";
  }

  reconnectNow(): void {
    this.stop();
    this.start();
  }

  send(msg: PanelToHelper): boolean {
    if (msg.type === "ping" || msg.type === "hello" || msg.type === "tool_result") return true;
    if (!this.agent) return false;
    this.agent.handle(msg);
    return true;
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    this.onStatus(s);
  }

  private async init(gen: number): Promise<void> {
    const provider = buildProvider(this.settings);
    let note: string | null = null;
    if (provider.apiKeyConfigured && provider.setup) {
      note = await provider.setup().catch((err: Error) => `⚠ ${err.message}`);
    }
    if (gen !== this.generation) return;

    const tools = panelTools();
    this.agent = new AgentSession({ provider, tools: () => tools, send: this.onMessage, settingsHint: HINT });
    this.setStatus("connected");
    this.onMessage({
      type: "hello_ack",
      protocolVersion: PROTOCOL_VERSION,
      helperVersion: "0.1.0",
      model: provider.model,
      provider: PROVIDER_INFO[this.settings.provider].title,
      apiKeyVar: provider.apiKeyVar,
      apiKeyConfigured: provider.apiKeyConfigured,
      tools: tools.map(({ name, runsIn, mutates }) => ({ name, runsIn, mutates })),
    });
    if (note && note.startsWith("⚠")) this.onMessage({ type: "error", message: note.replace(/^⚠\s*/, "") });
  }
}
