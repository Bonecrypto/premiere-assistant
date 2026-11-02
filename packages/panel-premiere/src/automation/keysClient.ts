import { LABEL_KEYS_COMBOS, parseHelperMessage } from "@pa/core";
import { getSavedPort } from "../connection.ts";
import { LABEL_KEYS, type LabelKey } from "./labels.ts";

/**
 * Связь с помощником для нажатия клавиш в Premiere (автопокраска клипов на таймлайне).
 * Отдельное короткое подключение — работает и во встроенном режиме ИИ, нужен только запущенный помощник.
 */

/** Клавиша метки: метка №i в порядке Premiere → Ctrl+Alt+Shift+(1…9, 0, F1…F6). */
export function labelCombo(label: LabelKey): string {
  return LABEL_KEYS_COMBOS[LABEL_KEYS.indexOf(label)] ?? "";
}

export function comboTitle(combo: string): string {
  return combo
    .split("+")
    .map((p) => (p === "ctrl" ? "Ctrl" : p === "alt" ? "Alt" : p === "shift" ? "Shift" : p.toUpperCase()))
    .join("+");
}

export interface KeysClient {
  send(keys: string[]): Promise<void>;
  close(): void;
}

const KEYS_PORT = 8766;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

/** Что не получилось при поиске нажимателя — для подсказки пользователю. */
export let lastKeysDiag = "";

/** «Нажиматель клавиш» (PowerShell, без Node) на localhost:8766 — основной путь. */
async function openHttpClient(): Promise<KeysClient | null> {
  const diag: string[] = [];
  for (const host of ["localhost", "127.0.0.1"]) {
    const base = `http://${host}:${KEYS_PORT}`;
    try {
      const r: Response = await withTimeout(fetch(`${base}/ping`), 2000);
      const text = await r.text();
      let j: any = null;
      try {
        j = JSON.parse(text);
      } catch {
        /* не JSON */
      }
      if (!j?.ok) {
        diag.push(`${host}: ответ ${r.status} ${text.slice(0, 60)}`);
        continue;
      }
      return {
        send: async (keys) => {
          const res: Response = await withTimeout(
            fetch(`${base}/keys`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Premiere-Assistant": "1" },
              body: JSON.stringify({ keys }),
            }),
            12000,
          );
          const out: any = await res.json().catch(() => ({}));
          if (!res.ok || !out?.ok) throw new Error(out?.error || `Нажиматель клавиш ответил ошибкой ${res.status}.`);
        },
        close: () => {},
      };
    } catch (err) {
      diag.push(`${host}: ${(err as Error)?.message || err}`);
    }
  }
  lastKeysDiag = diag.join("; ");
  return null;
}

/** Найти, кто нажмёт клавиши: сначала «нажиматель клавиш», затем помощник (Node). Ошибка "helper" — никого нет. */
export async function openKeysClient(): Promise<KeysClient> {
  const http = await openHttpClient();
  if (http) return http;
  return openWsClient();
}

function openWsClient(timeoutMs = 2500): Promise<KeysClient> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${getSavedPort()}`);
    } catch {
      reject(new Error("helper"));
      return;
    }
    const waiting = new Map<string, { ok(): void; fail(e: Error): void }>();
    let n = 0;
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* уже закрыт */
      }
      reject(new Error("helper"));
    }, timeoutMs);
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("helper"));
    };
    ws.onmessage = (e) => {
      const msg = parseHelperMessage(String(e.data));
      if (msg && msg.type === "error") {
        // Старый помощник не знает команду send_keys и отвечает «непонятное сообщение».
        // Старый помощник (Node) не умеет нажимать клавиши — считаем, что нажимателя нет.
        const err = new Error("OLD_HELPER");
        waiting.forEach((w) => w.fail(err));
        waiting.clear();
        return;
      }
      if (msg && msg.type === "keys_done") {
        const w = waiting.get(msg.id);
        if (!w) return;
        waiting.delete(msg.id);
        if (msg.ok) w.ok();
        else w.fail(new Error(msg.error || "Помощник не смог нажать клавиши."));
      }
    };
    ws.onclose = () => waiting.forEach((w) => w.fail(new Error("Связь с помощником прервалась.")));
    ws.onopen = () => {
      clearTimeout(timer);
      resolve({
        send: (keys) =>
          new Promise<void>((ok, fail) => {
            const id = `k${++n}`;
            waiting.set(id, { ok, fail });
            ws.send(JSON.stringify({ type: "send_keys", id, keys }));
            setTimeout(() => {
              if (waiting.delete(id)) fail(new Error("Помощник не ответил."));
            }, 12000);
          }),
        close: () => {
          try {
            ws.close();
          } catch {
            /* уже закрыт */
          }
        },
      });
    };
  });
}
