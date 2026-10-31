import {
  DEFAULT_HELPER_PORT,
  parseHelperMessage,
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  type HelperToPanel,
  type PanelToHelper,
} from "@pa/core";
import { hostInfo, storageGet, storageSet } from "./env.ts";
import { hostTools } from "./hostTools/index.ts";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

const PORT_KEY = "helperPort";

export function getSavedPort(): number {
  const n = Number(storageGet(PORT_KEY));
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_HELPER_PORT;
}

export function savePort(port: number): void {
  storageSet(PORT_KEY, String(port));
}

/** Подключение к локальному помощнику с автоматическим переподключением. */
export class HelperConnection {
  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryDelay = 1000;
  private stopped = false;
  status: ConnectionStatus = "disconnected";

  constructor(
    private port: number,
    private readonly onMessage: (msg: HelperToPanel) => void,
    private readonly onStatus: (status: ConnectionStatus) => void,
  ) {}

  /**
   * Именно 127.0.0.1, а не localhost: в Windows localhost часто означает IPv6 (::1),
   * а помощник слушает только IPv4-адрес 127.0.0.1.
   */
  get url(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.stopPing();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.ws?.close();
    this.ws = null;
    this.setStatus("disconnected");
  }

  setPort(port: number): void {
    this.port = port;
    this.stop();
    this.retryDelay = 1000;
    this.start();
  }

  /** Переподключиться сразу, не дожидаясь таймера. */
  reconnectNow(): void {
    if (this.status === "connected") return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryDelay = 1000;
    this.ws?.close();
    this.open();
  }

  send(msg: PanelToHelper): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.onStatus(status);
    }
  }

  private open(): void {
    if (this.stopped) return;
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      console.error("WebSocket не создан:", err);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.retryDelay = 1000;
      this.setStatus("connected");
      this.startPing();
      this.send({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        client: "panel-premiere",
        hostApp: hostInfo(),
        hostTools: hostTools.map((t) => t.spec),
      });
    };
    ws.onmessage = (event) => {
      const msg = parseHelperMessage(String(event.data));
      if (msg) this.onMessage(msg);
      else console.warn("Непонятное сообщение от помощника:", event.data);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.stopPing();
      this.ws = null;
      this.setStatus("disconnected");
      this.scheduleRetry();
    };
    ws.onerror = () => {
      /* onclose придёт следом */
    };
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ type: "ping" }), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 10_000);
  }
}
