import { useState } from "react";
import type { ChatItem } from "../state.ts";
import { Button } from "./Button.tsx";

type ConfirmItem = Extract<ChatItem, { kind: "confirm" }>;

const STATE_TEXT: Record<ConfirmItem["state"], string> = {
  pending: "",
  approved: "✔ Разрешено",
  rejected: "✖ Отклонено",
  expired: "Запрос больше не актуален",
};

/** Карточка подтверждения: что именно изменится + кнопки. */
export function ConfirmCard(props: { item: ConfirmItem; onAnswer(approved: boolean): void }) {
  const { item } = props;
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div className={`confirm confirm-${item.state}`}>
      <div className="confirm-head">
        <span className="confirm-title">Нужно подтверждение</span>
        <span className="confirm-tool">{item.toolName}</span>
      </div>
      <div className="confirm-summary">{item.summary}</div>
      <div className="link" onClick={() => setShowDetails((v) => !v)}>
        {showDetails ? "Скрыть параметры" : "Показать параметры"}
      </div>
      {showDetails ? <pre className="confirm-input">{JSON.stringify(item.input, null, 2)}</pre> : null}
      {item.state === "pending" ? (
        <div className="confirm-actions">
          <Button variant="primary" onClick={() => props.onAnswer(true)}>
            Выполнить
          </Button>
          <Button variant="secondary" onClick={() => props.onAnswer(false)}>
            Отклонить
          </Button>
        </div>
      ) : (
        <div className="confirm-state">{STATE_TEXT[item.state]}</div>
      )}
    </div>
  );
}
