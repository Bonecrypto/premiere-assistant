import { useState } from "react";
import type { ChatItem } from "../state.ts";
import { Button, IconTile } from "./Button.tsx";

type ConfirmItem = Extract<ChatItem, { kind: "confirm" }>;

const DONE_TEXT: Record<Exclude<ConfirmItem["state"], "pending">, string> = {
  approved: "Разрешено",
  rejected: "Отклонено",
  expired: "Запрос больше не актуален",
};

/** Карточка подтверждения в духе системного алерта Apple: что изменится и две кнопки. */
export function ConfirmCard(props: { item: ConfirmItem; onAnswer(approved: boolean): void }) {
  const { item } = props;
  const [showDetails, setShowDetails] = useState(false);
  const pending = item.state === "pending";
  return (
    <div className={`confirm confirm-${item.state}`}>
      <div className="confirm-head">
        <IconTile glyph={pending ? "?" : item.state === "approved" ? "✓" : "–"} tone={pending ? "orange" : item.state === "approved" ? "green" : "gray"} />
        <div className="confirm-head-text">
          <div className="confirm-title">{item.state === "pending" ? "Разрешить действие?" : DONE_TEXT[item.state]}</div>
          <div className="confirm-tool">{item.toolName}</div>
        </div>
      </div>
      <div className="confirm-summary">{item.summary}</div>
      <div className="disclosure" onClick={() => setShowDetails((v) => !v)}>
        {showDetails ? "▾ Скрыть параметры" : "▸ Параметры"}
      </div>
      {showDetails ? <pre className="code-block">{JSON.stringify(item.input, null, 2)}</pre> : null}
      {pending ? (
        <div className="confirm-actions">
          <Button variant="secondary" onClick={() => props.onAnswer(false)} className="confirm-btn">
            Отклонить
          </Button>
          <Button variant="primary" onClick={() => props.onAnswer(true)} className="confirm-btn">
            Выполнить
          </Button>
        </div>
      ) : null}
    </div>
  );
}
