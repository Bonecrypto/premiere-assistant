import { useState, type KeyboardEvent } from "react";
import { Button } from "./Button.tsx";

export function Composer(props: { disabled: boolean; busy: boolean; onSend(text: string): void; onStop(): void }) {
  const [text, setText] = useState("");
  const canSend = !props.disabled && !props.busy && text.trim().length > 0;

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
      <textarea
        className="composer-input"
        placeholder={props.disabled ? "Нет связи с помощником…" : "Спросите или поручите… (Enter — отправить)"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="composer-actions">
        {props.busy ? (
          <Button variant="danger" onClick={props.onStop}>
            Стоп
          </Button>
        ) : (
          <Button variant="primary" onClick={submit} disabled={!canSend}>
            Отправить
          </Button>
        )}
      </div>
    </div>
  );
}
