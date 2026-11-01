/**
 * Чтение потока Server-Sent Events из ответа fetch. Работает и в Node, и в UXP (Premiere):
 * если среда не умеет читать тело по частям (нет getReader/TextDecoder), читаем ответ целиком —
 * текст придёт одним куском, но всё остальное работает так же.
 */
export class SseAbortError extends Error {}

function* parseEvents(block: string): Generator<string> {
  for (const line of block.split("\n")) {
    if (!line.startsWith("data:")) continue; // комментарии (": ...") и прочее пропускаем
    const data = line.slice(5).trim();
    if (data && data !== "[DONE]") yield data;
  }
}

export async function* readSse<T>(res: Response, signal: AbortSignal): AsyncGenerator<T> {
  const body = res.body as ReadableStream<Uint8Array> | null;
  const canStream = body && typeof body.getReader === "function" && typeof TextDecoder !== "undefined";

  if (!canStream) {
    const text = (await res.text()).replace(/\r\n/g, "\n");
    if (signal.aborted) throw new SseAbortError("aborted");
    for (const block of text.split("\n\n")) for (const data of parseEvents(block)) yield JSON.parse(data) as T;
    return;
  }

  const reader = body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (signal.aborted) throw new SseAbortError("aborted");
        throw err;
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const data of parseEvents(block)) yield JSON.parse(data) as T;
      }
    }
    for (const data of parseEvents(buf)) yield JSON.parse(data) as T;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* уже освобождён */
    }
  }
}
