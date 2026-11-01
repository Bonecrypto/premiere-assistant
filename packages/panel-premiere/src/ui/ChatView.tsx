import type { HelloAckMsg } from "@pa/core";
import { useEffect, useRef } from "react";
import type { ChatItem } from "../state.ts";
import { IconTile } from "./Button.tsx";
import { Logo } from "./Logo.tsx";
import { ConfirmCard } from "./ConfirmCard.tsx";
import type { HealthState } from "./Header.tsx";
import { RichText } from "./RichText.tsx";
import { Typing } from "./Typing.tsx";

/** Примеры запросов: узнавание вместо припоминания — не нужно гадать, что умеет ассистент. */
const SUGGESTIONS = [
  "Что за проект и секвенция открыты?",
  "Как выставить громкость на −14 LUFS для YouTube?",
  "Запомни: мой стандарт — true peak −1 dBTP",
];

export function ChatView(props: {
  items: ChatItem[];
  helper: HelloAckMsg | null;
  health: HealthState;
  busy: boolean;
  onConfirm(requestId: string, approved: boolean): void;
  onSuggestion(text: string): void;
  onOpenSettings(): void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Автопрокрутка вниз при новых сообщениях и стриминге.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.items, props.busy]);

  return (
    <div className="chat" ref={scrollRef}>
      <div className="scroll-inner">
      {props.items.length === 0 ? (
        <EmptyState health={props.health} onSuggestion={props.onSuggestion} onOpenSettings={props.onOpenSettings} />
      ) : null}
      {props.items.map((it, idx) => {
        const prev = props.items[idx - 1];
        // Подряд идущие сообщения одного автора — без лишнего отступа (как в iMessage).
        const grouped = prev && prev.kind === it.kind && (it.kind === "user" || it.kind === "assistant");
        switch (it.kind) {
          case "user":
            return (
              <div key={it.id} className={`msg msg-user${grouped ? " is-grouped" : ""}`}>
                <div className="bubble bubble-user">{it.text}</div>
              </div>
            );
          case "assistant":
            return (
              <div key={it.id} className={`msg msg-assistant${grouped ? " is-grouped" : ""}`}>
                <div className="bubble bubble-assistant">
                  <RichText text={it.text} />
                  {it.stopReason === "cancelled" ? <div className="bubble-meta">Остановлено</div> : null}
                </div>
              </div>
            );
          case "confirm":
            return <ConfirmCard key={it.id} item={it} onAnswer={(ok) => props.onConfirm(it.id, ok)} />;
          case "notice":
            return (
              <div key={it.id} className={`notice notice-${it.tone}`}>
                <span className="notice-icon">{it.tone === "error" ? "!" : "i"}</span>
                <span className="notice-text">{it.text}</span>
              </div>
            );
        }
      })}
      {showTyping(props) ? (
        <div className="msg msg-assistant">
          <div className="bubble bubble-assistant bubble-typing">
            <Typing />
          </div>
        </div>
      ) : null}
    </div>
    </div>
  );
}

/** «Печатает…» — пока ответ идёт, а последний элемент не пишущийся текст и не ждущая карточка. */
function showTyping(props: { busy: boolean; items: ChatItem[] }): boolean {
  if (!props.busy) return false;
  const last = props.items[props.items.length - 1];
  if (!last) return true;
  if (last.kind === "assistant" && last.streaming) return false;
  if (last.kind === "confirm" && last.state === "pending") return false;
  return true;
}

function EmptyState(props: { health: HealthState; onSuggestion(t: string): void; onOpenSettings(): void }) {
  const ready = props.health === "ok";
  return (
    <div className="empty">
      <Logo size={48} className="empty-logo" />
      <div className="empty-title">Чем помочь?</div>
      <div className="empty-text">
        Спросите о монтаже, звуке или Premiere — или поручите действие. Всё, что меняет проект, я сначала покажу вам.
      </div>
      {ready ? (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <div key={s} className="suggestion" onClick={() => props.onSuggestion(s)}>
              {s}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-warning" onClick={props.onOpenSettings}>
          <IconTile glyph="!" tone="orange" />
          <div className="empty-warning-text">
            {props.health === "warn"
              ? "В помощнике не задан API-ключ. Открыть настройки"
              : "Помощник не запущен. Запустите start-helper.cmd (или один раз autostart-on.cmd — и он будет стартовать сам с Windows)"}
          </div>
        </div>
      )}
    </div>
  );
}
