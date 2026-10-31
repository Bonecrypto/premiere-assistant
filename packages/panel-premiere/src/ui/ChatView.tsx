import type { HelloAckMsg } from "@pa/core";
import { useEffect, useRef } from "react";
import type { ConnectionStatus } from "../connection.ts";
import type { ChatItem } from "../state.ts";
import { ConfirmCard } from "./ConfirmCard.tsx";
import { RichText } from "./RichText.tsx";

export function ChatView(props: {
  items: ChatItem[];
  helper: HelloAckMsg | null;
  connection: ConnectionStatus;
  busy: boolean;
  onConfirm(requestId: string, approved: boolean): void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Автопрокрутка вниз при новых сообщениях и стриминге.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.items, props.busy]);

  return (
    <div className="chat" ref={scrollRef}>
      {props.items.length === 0 ? <Welcome connection={props.connection} helper={props.helper} /> : null}
      {props.items.map((it) => {
        switch (it.kind) {
          case "user":
            return (
              <div key={it.id} className="msg msg-user">
                <div className="bubble bubble-user">{it.text}</div>
              </div>
            );
          case "assistant":
            return (
              <div key={it.id} className="msg msg-assistant">
                <div className="bubble bubble-assistant">
                  <RichText text={it.text} />
                  {it.stopReason === "cancelled" ? <div className="meta">остановлено</div> : null}
                </div>
              </div>
            );
          case "confirm":
            return <ConfirmCard key={it.id} item={it} onAnswer={(ok) => props.onConfirm(it.id, ok)} />;
          case "notice":
            return (
              <div key={it.id} className={`notice notice-${it.tone}`}>
                {it.text}
              </div>
            );
        }
      })}
      {showTyping(props) ? (
        <div className="msg msg-assistant">
          <div className="bubble bubble-assistant typing">Думаю…</div>
        </div>
      ) : null}
    </div>
  );
}

/** «Думаю…» — пока ответ идёт, а последний элемент не пишущийся текст и не ждущая карточка. */
function showTyping(props: { busy: boolean; items: ChatItem[] }): boolean {
  if (!props.busy) return false;
  const last = props.items[props.items.length - 1];
  if (!last) return true;
  if (last.kind === "assistant" && last.streaming) return false;
  if (last.kind === "confirm" && last.state === "pending") return false;
  return true;
}

function Welcome(props: { connection: ConnectionStatus; helper: HelloAckMsg | null }) {
  if (props.connection !== "connected") {
    return (
      <div className="welcome">
        <div className="welcome-title">Помощник не запущен</div>
        <div className="hint">
          В папке проекта выполните <code>npm start</code> — панель подключится сама.
        </div>
      </div>
    );
  }
  return (
    <div className="welcome">
      <div className="welcome-title">Чем помочь?</div>
      <div className="hint">
        Спросите что угодно о монтаже, звуке или Premiere — или поручите действие. Всё, что меняет проект или
        файлы, я сначала покажу на подтверждение.
      </div>
      {props.helper && !props.helper.apiKeyConfigured ? (
        <div className="notice notice-error">
          В помощнике не задан ANTHROPIC_API_KEY. Укажите его в packages/helper/.env и перезапустите помощника.
        </div>
      ) : null}
    </div>
  );
}
