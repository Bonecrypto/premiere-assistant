import { loadKeyFor } from "../agent/settings.ts";

/**
 * Голосовой ввод.
 * 1) Если среда умеет записывать микрофон (getUserMedia + MediaRecorder) и есть ключ Gemini —
 *    записываем и расшифровываем через Gemini (бесплатный тариф понимает аудио).
 * 2) Иначе — голосовой ввод Windows (Win+H): он печатает прямо в поле сообщения.
 *    В UXP-панелях Premiere доступа к микрофону, по нашим данным, нет — поэтому это основной путь.
 */

export type VoiceMode = "record" | "windows";

export function canRecord(): boolean {
  const nav: any = typeof navigator !== "undefined" ? navigator : null;
  return Boolean(nav?.mediaDevices?.getUserMedia) && typeof (globalThis as any).MediaRecorder === "function";
}

export async function voiceMode(): Promise<VoiceMode> {
  if (!canRecord()) return "windows";
  const key = await loadKeyFor("gemini").catch(() => "");
  return key ? "record" : "windows";
}

export interface Recording {
  stop(): Promise<Blob>;
  cancel(): void;
}

export async function startRecording(): Promise<Recording> {
  const stream: MediaStream = await (navigator as any).mediaDevices.getUserMedia({ audio: true });
  const MR = (globalThis as any).MediaRecorder;
  const rec = new MR(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e: any) => e.data && e.data.size && chunks.push(e.data);
  rec.start();
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        };
        rec.stop();
      }),
    cancel: () => {
      try {
        rec.stop();
      } catch {
        /* уже остановлен */
      }
      release();
    },
  };
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Расшифровка записи через Gemini. Возвращает текст или бросает понятную ошибку. */
export async function transcribe(blob: Blob): Promise<string> {
  const key = await loadKeyFor("gemini");
  if (!key) throw new Error("Для расшифровки голоса нужен ключ Gemini (Настройки → ИИ).");
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Распознай речь в аудио и верни только текст сказанного, без комментариев. Язык — тот, на котором говорят." },
          { inline_data: { mime_type: (blob.type || "audio/webm").split(";")[0], data: await toBase64(blob) } },
        ],
      },
    ],
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini не смог расшифровать (${res.status}).`);
  const json: any = await res.json();
  const text: string = (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Не расслышал — попробуйте ещё раз.");
  return text;
}
