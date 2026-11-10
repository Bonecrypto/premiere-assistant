import { LABEL_KEYS_COMBOS, parseHelperMessage } from "@pa/core";
import { getSavedPort } from "../connection.ts";
import { LABEL_KEYS, type LabelKey } from "./labels.ts";
import { launchKeysHelper, MAC_HELPER_HINT } from "./keysLauncher.ts";
import { isMac, isUXP } from "../env.ts";

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
    .map((p) =>
      isMac()
        ? p === "ctrl" ? "⌘" : p === "alt" ? "⌥" : p === "shift" ? "⇧" : p.toUpperCase()
        : p === "ctrl" ? "Ctrl" : p === "alt" ? "Alt" : p === "shift" ? "Shift" : p.toUpperCase(),
    )
    .join(isMac() ? "" : "+");
}

export interface KeysClient {
  send(keys: string[]): Promise<void>;
  close(): void;
  /** Адрес программы в трее (только для HTTP-пути) — для ИИ-функций (удаление фона). */
  base?: string;
}

const KEYS_PORT = 8766;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

/** Минимальная версия программы-нажимателя (новая схема клавиш меток). */
const MIN_VERSION = 6;
let oldVersionRunning = false;
/** Какая версия нужна сейчас (ИИ-функции требуют новее, чем клавиши). */
let needVersion = MIN_VERSION;

/** Что не получилось при поиске нажимателя — для подсказки пользователю. */
export let lastKeysDiag = "";

/** «Нажиматель клавиш» (программа tools/keys-app, значок в трее) на localhost:8766 — основной путь. */
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
      if (typeof j.version === "number" && j.version < needVersion) {
        // Версии с 5 умеют закрываться по команде — тогда панель сама запустит новую.
        try {
          const q: Response = await withTimeout(fetch(`${base}/quit`, { method: "POST", headers: { "X-Premiere-Assistant": "1" } }), 2000);
          if (q.ok) {
            await new Promise((r) => setTimeout(r, 1500));
            return null;
          }
        } catch {
          /* старая версия без /quit */
        }
        oldVersionRunning = true;
        lastKeysDiag =
          "запущена старая версия программы-нажимателя: нажмите её значок в трее (возле часов) → «Выход», затем «Ещё раз» — панель скачает новую.";
        return null;
      }
      return {
        base,
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
  if (!oldVersionRunning) lastKeysDiag = diag.join("; ");
  return null;
}

/** Найти, кто нажмёт клавиши: сначала «нажиматель клавиш», затем помощник (Node). Ошибка "helper" — никого нет. */
export async function openKeysClient(minVersion = MIN_VERSION): Promise<KeysClient> {
  oldVersionRunning = false;
  needVersion = minVersion;
  const http = await openHttpClient();
  if (http) return http;
  // Старая версия, которая не умеет закрываться по команде, — новая версия при запуске закроет её сама.
  const hadOld = oldVersionRunning;
  // Нет — запускаем встроенный нажиматель сами и ждём, пока он ответит.
  if (isUXP) {
    const err = await launchKeysHelper();
    if (!err) {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 800));
        oldVersionRunning = false;
        const again = await openHttpClient();
        if (again) return again;
      }
      if (oldVersionRunning || hadOld) {
        lastKeysDiag =
          "в трее осталась старая версия программы-нажимателя: нажмите её значок (возле часов) → «Выход», затем «Ещё раз».";
        throw new Error("helper");
      }
      lastKeysDiag = isMac() ? `${MAC_HELPER_HINT} Если уже установлен и не отвечает — откройте его заново из «Программ» (возможно, после обновления нужна новая версия).` : `запустил, но не ответил: ${lastKeysDiag}`;
    } else {
      lastKeysDiag = isMac() ? err : `не удалось запустить: ${err}`;
    }
  }
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
