import {
  AgentSession,
  CancelledError,
  makeId,
  PROTOCOL_VERSION,
  type ChatProvider,
  type HelperToPanel,
  type PanelToHelper,
  type ToolDef,
  type ToolSpec,
} from "@pa/core";
import { config, HELPER_VERSION } from "./config.ts";
import { checkHostToolSpec, type ToolRegistry } from "./registry.ts";

interface PendingHostCall {
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Одна подключённая панель = одна сессия. Агентный цикл — общий (AgentSession из @pa/core);
 * здесь — то, что относится к связи с панелью: приветствие, host-инструменты панели и их результаты.
 */
export class Session {
  private registry: ToolRegistry;
  private ready = false;
  private agent: AgentSession;
  private pendingHostCalls = new Map<string, PendingHostCall>();

  constructor(
    private readonly provider: ChatProvider,
    baseRegistry: ToolRegistry,
    private readonly send: (msg: HelperToPanel) => void,
    private readonly log: (text: string) => void,
  ) {
    this.registry = baseRegistry.clone();
    this.agent = new AgentSession({
      provider,
      tools: () => this.registry.list(),
      send,
      log,
      maxSteps: config.maxAgentSteps,
      settingsHint: config.envPath,
      onCancel: () => this.rejectHostCalls(),
    });
  }

  handle(msg: PanelToHelper): void {
    switch (msg.type) {
      case "hello":
        this.onHello(msg.client, msg.protocolVersion, msg.hostTools ?? []);
        break;
      case "tool_result": {
        const call = this.pendingHostCalls.get(msg.callId);
        if (call) {
          this.pendingHostCalls.delete(msg.callId);
          clearTimeout(call.timer);
          if (msg.ok) call.resolve(msg.result);
          else call.reject(new Error(msg.error || "Панель вернула ошибку без описания"));
        }
        break;
      }
      case "user_message":
        if (!this.ready) {
          this.send({ type: "error", message: "Панель ещё не представилась (hello). Переподключитесь." });
          return;
        }
        this.agent.handle(msg);
        break;
      default:
        this.agent.handle(msg);
    }
  }

  dispose(): void {
    this.agent.dispose();
  }

  private rejectHostCalls(): void {
    for (const call of this.pendingHostCalls.values()) {
      clearTimeout(call.timer);
      call.reject(new CancelledError());
    }
    this.pendingHostCalls.clear();
  }

  private onHello(client: string, protocolVersion: number, hostTools: ToolSpec[]): void {
    if (protocolVersion !== PROTOCOL_VERSION) {
      this.send({
        type: "error",
        message: `Версии протокола не совпадают: панель ${protocolVersion}, помощник ${PROTOCOL_VERSION}. Обновите и пересоберите обе части.`,
      });
    }
    if (this.ready) {
      this.send({ type: "error", message: "Повторное приветствие игнорируется." });
      return;
    }
    for (const spec of hostTools) {
      const problem = checkHostToolSpec(spec);
      if (problem) {
        this.log(`host-инструмент отклонён: ${problem}`);
        continue;
      }
      try {
        this.registry.register(this.makeHostTool(spec));
      } catch (err) {
        this.log(`host-инструмент отклонён: ${(err as Error).message}`);
      }
    }
    this.ready = true;
    const tools = this.registry.list();
    this.log(`клиент "${client}" готов, инструментов: ${tools.length} (${tools.map((t) => t.name).join(", ")})`);
    this.send({
      type: "hello_ack",
      protocolVersion: PROTOCOL_VERSION,
      helperVersion: HELPER_VERSION,
      model: this.provider.model,
      provider: this.provider.title,
      apiKeyVar: this.provider.apiKeyVar,
      apiKeyConfigured: this.provider.apiKeyConfigured,
      tools: tools.map(({ name, runsIn, mutates }) => ({ name, runsIn, mutates })),
    });
  }

  /** Обёртка: host-инструмент выполняется в панели, помощник лишь пересылает вызов. */
  private makeHostTool(spec: ToolSpec): ToolDef {
    return {
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
      runsIn: "host",
      mutates: spec.mutates,
      describe: spec.confirmText ? () => spec.confirmText! : undefined,
      run: (input, ctx) =>
        new Promise((resolve, reject) => {
          const callId = makeId("c_");
          const timer = setTimeout(() => {
            this.pendingHostCalls.delete(callId);
            reject(new Error(`Панель не ответила за ${config.hostToolTimeoutMs / 1000} с`));
          }, config.hostToolTimeoutMs);
          this.pendingHostCalls.set(callId, { resolve, reject, timer });
          ctx.signal.addEventListener(
            "abort",
            () => {
              const call = this.pendingHostCalls.get(callId);
              if (call) {
                this.pendingHostCalls.delete(callId);
                clearTimeout(call.timer);
                call.reject(new CancelledError());
              }
            },
            { once: true },
          );
          this.send({ type: "tool_call", callId, name: spec.name, input });
        }),
    };
  }
}
