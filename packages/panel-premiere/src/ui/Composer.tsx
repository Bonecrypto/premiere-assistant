import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/** Поле ввода-«пилюля» с круглой кнопкой отправки, как в «Сообщениях». */
export function Composer(props: {
  disabled: boolean;
  busy: boolean;
  draft: string | null;
  onDraftConsumed(): void;
  onSend(text: string): void;
  onStop(): void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = !props.disabled && !props.busy && text.trim().length > 0;

  // Подсказка из пустого экрана подставляется в поле — пользователь может поправить перед отправкой.
  useEffect(() => {
    if (props.draft !== null) {
      setText(props.draft);
      props.onDraftConsumed();
      ref.current?.focus();
    }
  }, [props.draft]);

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

  return (
    <div className="composer">
      <div className={`composer-field${props.disabled ? " is-disabled" : ""}`}>
        <textarea
          ref={ref}
          className="composer-input"
          placeholder={props.disabled ? "Нет связи с помощником" : "Сообщение"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {props.busy ? (
          <div className="round-btn round-stop" title="Остановить" onClick={props.onStop}>
            <span className="stop-square" />
          </div>
        ) : (
          <div
            className={`round-btn round-send${canSend ? "" : " is-disabled"}`}
            title="Отправить (Enter)"
            onClick={submit}
          >
            ↑
          </div>
        )}
      </div>
      <div className="composer-hint">Enter — отправить · Shift+Enter — новая строка</div>
    </div>
  );
}
