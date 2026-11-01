import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { startRecording, transcribe, voiceMode, type Recording } from "../voice/voice.ts";
import { Icon } from "./Icon.tsx";

type Voice = { state: "idle" } | { state: "recording"; since: number } | { state: "transcribing" } | { state: "hint" } | { state: "error"; text: string };

/** Высота поля по содержимому: от одной строки до пяти. */
function fieldHeight(text: string): number {
  const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 38)), 0);
  return Math.min(5, Math.max(1, lines)) * 18 + 10;
}

/**
 * Поле ввода как в «Сообщениях»: круглая «пилюля», внутри справа — микрофон,
 * а когда есть текст — круглая кнопка отправки. Во время ответа — «Стоп».
 */
export function Composer(props: {
  disabled: boolean;
  busy: boolean;
  draft: string | null;
  onDraftConsumed(): void;
  onSend(text: string): void;
  onStop(): void;
}) {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<Voice>({ state: "idle" });
  const [, tick] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const rec = useRef<Recording | null>(null);
  const canSend = !props.disabled && !props.busy && text.trim().length > 0;

  // Подсказка из пустого экрана подставляется в поле — пользователь может поправить перед отправкой.
  useEffect(() => {
    if (props.draft !== null) {
      setText(props.draft);
      props.onDraftConsumed();
      ref.current?.focus();
    }
  }, [props.draft]);

  // Таймер записи.
  useEffect(() => {
    if (voice.state !== "recording") return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [voice.state]);

  useEffect(() => () => rec.current?.cancel(), []);

  const submit = () => {
    if (!canSend) return;
    props.onSend(text.trim());
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter — отправить, Shift+Enter — новая строка.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onMic = async () => {
    if (props.disabled) return;
    if ((await voiceMode()) === "windows") {
      // Голосовой ввод Windows печатает в поле, где стоит курсор.
      ref.current?.focus();
      setVoice({ state: "hint" });
      return;
    }
    try {
      rec.current = await startRecording();
      setVoice({ state: "recording", since: Date.now() });
    } catch {
      ref.current?.focus();
      setVoice({ state: "hint" });
    }
  };

  const finishRecording = async (send: boolean) => {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    setVoice({ state: "transcribing" });
    try {
      const said = await transcribe(await r.stop());
      const next = text ? `${text.trimEnd()} ${said}` : said;
      setVoice({ state: "idle" });
      if (send && !props.busy) {
        props.onSend(next.trim());
        setText("");
      } else {
        setText(next);
        ref.current?.focus();
      }
    } catch (err) {
      setVoice({ state: "error", text: (err as Error)?.message || "Не получилось распознать." });
    }
  };

  const cancelRecording = () => {
    rec.current?.cancel();
    rec.current = null;
    setVoice({ state: "idle" });
  };

  const recording = voice.state === "recording";
  const seconds = recording ? Math.floor((Date.now() - voice.since) / 1000) : 0;

  return (
    <div className="composer">
      {voice.state === "hint" ? (
        <div className="voice-pop">
          <div className="voice-pop-icon grad-purple">
            <Icon name="mic" size={14} />
          </div>
          <div className="voice-pop-text">
            <div className="voice-pop-title">Скажите запрос голосом</div>
            <div className="voice-pop-sub">
              Нажмите <span className="kbd">Win</span> + <span className="kbd">H</span> и говорите — Windows напечатает текст прямо в поле.
            </div>
          </div>
          <div className="voice-pop-close" onClick={() => setVoice({ state: "idle" })} title="Закрыть">
            ✕
          </div>
        </div>
      ) : null}
      {voice.state === "error" ? (
        <div className="voice-pop voice-pop-error" onClick={() => setVoice({ state: "idle" })}>
          <div className="voice-pop-text">
            <div className="voice-pop-sub">{voice.text}</div>
          </div>
          <div className="voice-pop-close">✕</div>
        </div>
      ) : null}

      <div className={`composer-field${props.disabled ? " is-disabled" : ""}${recording ? " is-recording" : ""}`}>
        {recording || voice.state === "transcribing" ? (
          <div className="voice-live">
            {recording ? <span className="rec-dot" /> : null}
            <span className="voice-live-text">{recording ? `Слушаю… ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "Распознаю…"}</span>
          </div>
        ) : (
          <textarea
            ref={ref}
            className="composer-input"
            style={{ height: fieldHeight(text) }}
            placeholder={props.disabled ? "Нет связи с помощником" : "Сообщение"}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              // Текст пошёл (в том числе из Win+H) — подсказку можно убрать.
              if (voice.state === "hint" && e.target.value.trim()) setVoice({ state: "idle" });
            }}
            onKeyDown={onKeyDown}
          />
        )}

        {recording ? (
          <>
            <div className="round-btn round-ghost" title="Отменить" onClick={cancelRecording}>
              ✕
            </div>
            <div className="round-btn round-send" title="Отправить сказанное" onClick={() => void finishRecording(true)}>
              <Icon name="send" size={14} className="send-icon" />
            </div>
          </>
        ) : props.busy ? (
          <div className="round-btn round-stop" title="Остановить" onClick={props.onStop}>
            <span className="stop-square" />
          </div>
        ) : text.trim() ? (
          <div className={`round-btn round-send${canSend ? "" : " is-disabled"}`} title="Отправить (Enter)" onClick={submit}>
            <Icon name="send" size={14} className="send-icon" />
          </div>
        ) : voice.state === "transcribing" ? null : (
          <div
            className={`round-btn round-mic${voice.state === "hint" ? " is-active" : ""}`}
            title="Сказать голосом"
            onClick={() => void onMic()}
          >
            <Icon name="mic" size={15} />
          </div>
        )}
      </div>
    </div>
  );
}
