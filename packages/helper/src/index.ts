import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { parsePanelMessage, type HelperToPanel } from "@pa/core";
import { config, envCreated, HELPER_DIR, HELPER_VERSION } from "./config.ts";
import { createProvider } from "./providers/index.ts";
import { ToolRegistry } from "./registry.ts";
import { Session } from "./session.ts";

function ts(): string {
  return new Date().toLocaleTimeString("ru-RU");
}
function log(text: string): void {
  console.log(`[${ts()}] ${text}`);
}

/**
 * Защита от чужих веб-страниц: браузер позволяет любому сайту открыть WebSocket на localhost
 * и всегда присылает заголовок Origin. Разрешаем подключения без Origin или с не-веб Origin
 * (так подключается UXP-панель) и явно перечисленные в HELPER_ALLOWED_ORIGINS.
 */
function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin || origin === "null") return true;
  if (config.allowedOrigins.includes(origin)) return true;
  return !/^https?:\/\//i.test(origin);
}

async function main(): Promise<void> {
  console.log(`\nPremiere Assistant — помощник v${HELPER_VERSION}`);

  if (envCreated) {
    console.warn(`ℹ Создан файл настроек ${config.envPath}\n  Впишите в него ключ и перезапустите помощника.`);
  } else if (!config.envFileFound) {
    console.warn(`⚠ Файл .env не найден: ${config.envPath}\n  Скопируйте .env.example в .env и заполните.`);
  }
  const provider = createProvider();
  if (!provider.apiKeyConfigured) {
    console.warn(`⚠ ${provider.apiKeyVar} не задан — ассистент не сможет отвечать. Впишите ключ в .env и перезапустите.`);
  }

  const registry = new ToolRegistry();
  const loaded = await registry.loadFromDir(path.join(HELPER_DIR, "src", "tools"));
  console.log(`Модель: ${provider.title} · ${provider.model}`);
  console.log(`Инструменты помощника: ${loaded.join(", ") || "нет"}`);

  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port: config.port,
    maxPayload: 16 * 1024 * 1024,
    verifyClient: ({ origin }: { origin?: string }) => {
      const ok = isOriginAllowed(origin);
      if (!ok) log(`⛔ отклонено подключение с Origin ${origin}`);
      return ok;
    },
  });

  wss.on("listening", () => {
    console.log(`\n✔ Жду панель на ws://127.0.0.1:${config.port}  (Ctrl+C — остановить)\n`);
  });

  wss.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `✖ Порт ${config.port} занят. Возможно, помощник уже запущен в другом окне. ` +
          `Закройте его или поменяйте HELPER_PORT в .env (и в настройках панели).`,
      );
    } else {
      console.error(`✖ Ошибка сервера: ${err.message}`);
    }
    process.exit(1);
  });

  let nextId = 1;
  wss.on("connection", (ws: WebSocket, req) => {
    const id = nextId++;
    const plog = (text: string) => log(`#${id} ${text}`);
    plog(`панель подключилась${req.headers.origin ? ` (Origin: ${req.headers.origin})` : ""}`);

    const send = (msg: HelperToPanel) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const session = new Session(provider, registry, send, plog);

    // Пинг, чтобы замечать «зависшие» подключения.
    let alive = true;
    ws.on("pong", () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) {
        plog("нет ответа на ping — закрываю подключение");
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 15_000);

    ws.on("message", (data) => {
      const msg = parsePanelMessage(data.toString());
      if (!msg) {
        send({ type: "error", message: "Помощник получил непонятное сообщение." });
        return;
      }
      session.handle(msg);
    });

    ws.on("close", () => {
      clearInterval(ping);
      session.dispose();
      plog("панель отключилась");
    });
  });

  const shutdown = () => {
    console.log("\nОстанавливаю помощника…");
    for (const ws of wss.clients) ws.close(1001, "helper shutdown");
    wss.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("✖ Помощник не запустился:", err);
  process.exit(1);
});
