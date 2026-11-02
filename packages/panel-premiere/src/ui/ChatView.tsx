import type { HelloAckMsg } from "@pa/core";
import { useEffect, useRef } from "react";
import type { ChatItem } from "../state.ts";
import { IconTile } from "./Button.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Logo } from "./Logo.tsx";
import { ConfirmCard } from "./ConfirmCard.tsx";
import type { HealthState } from "./Header.tsx";
import { RichText } from "./RichText.tsx";
import { Typing } from "./Typing.tsx";

/** Примеры запросов: узнавание вместо припоминания — не нужно гадать, что умеет ассистент. */
/** Примеры запросов плитками: узнавание вместо припоминания. Текст подставляется в поле — можно поправить. */
const SUGGESTIONS: Array<{ title: string; text: string; icon: IconName; tone: string }> = [
  { title: "Покрась таймлайн", text: "Покрась таймлайн по моим правилам", icon: "palette", tone: "pink" },
  { title: "Подпиши дорожки", text: "Подпиши звуковые дорожки по содержимому", icon: "tasks", tone: "blue" },
  { title: "Переходы на стыки", text: "Поставь растворение 0.5 с на все стыки выделенных клипов", icon: "fliph", tone: "indigo" },
  { title: "Что открыто?", text: "Что за проект и секвенция открыты?", icon: "chat", tone: "green" },
  { title: "Музыка под голос", text: "Приглуши музыку под голосом на −12 дБ", icon: "speaker", tone: "orange" },
  { title: "Шейк на ударах", text: "Сделай шейк на выделенных клипах", icon: "sparkle", tone: "purple" },
];

/** Быстрые команды над полем ввода (подставляются в поле — можно поправить перед отправкой). */
export const QUICK_COMMANDS: string[] = [
  "Покрась таймлайн",
  "Тёплый цвет на выделенных",
  "Шейк на выделенных",
  "Убери пустоты между выделенными",
  "Приглуши музыку под голосом",
  "Фейды на выделенный звук",
  "Разложи проект по папкам",
];

export function ChatView(props: {
  items: ChatItem[];
  helper: HelloAckMsg | null;
  health: HealthState;
  busy: boolean;
  onConfirm(requestId: string, approved: boolean): void;
  onSuggestion(text: string): void;
  onOpenSettings(): void;
  embedded: boolean;
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
        <EmptyState health={props.health} embedded={props.embedded} onSuggestion={props.onSuggestion} onOpenSettings={props.onOpenSettings} />
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

function EmptyState(props: { health: HealthState; embedded: boolean; onSuggestion(t: string): void; onOpenSettings(): void }) {
  const ready = props.health === "ok";
  return (
    <div className="empty">
      <Logo size={44} className="empty-logo" />
      <div className="empty-title">Чем помочь?</div>
      <div className="empty-text">Спросите о монтаже или поручите действие. Всё, что меняет проект, я сначала покажу.</div>
      {ready ? (
        <div className="suggest-grid">
          {[0, 2, 4].map((r) => (
            <div key={r} className="bento-row">
              {SUGGESTIONS.slice(r, r + 2).map((s) => (
                <div key={s.title} className="bento-tile suggest-tile" onClick={() => props.onSuggestion(s.text)}>
                  <div className={`bento-icon grad-${s.tone}`}>
                    <Icon name={s.icon} size={16} />
                  </div>
                  <div className="bento-title">{s.title}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-warning" onClick={props.onOpenSettings}>
          <IconTile glyph="!" tone="orange" />
          <div className="empty-warning-text">
            {props.health === "warn"
              ? props.embedded
                ? "Вставьте ключ ИИ в Настройках — один раз. Открыть настройки"
                : "В помощнике не задан API-ключ. Открыть настройки"
              : props.health === "connecting"
                ? "Подключаю ИИ…"
                : props.embedded
                  ? "ИИ не подключён. Открыть настройки"
                  : "Помощник не запущен. Запустите start-helper.cmd (или один раз autostart-on.cmd — и он будет стартовать сам с Windows)"}
          </div>
        </div>
      )}
    </div>
  );
}

/** Строка быстрых команд над полем ввода. */
export function QuickBar(props: { onPick(text: string): void }) {
  return (
    <div className="quick-bar">
      {QUICK_COMMANDS.map((q) => (
        <div key={q} className="quick-chip" onClick={() => props.onPick(q)}>
          {q}
        </div>
      ))}
    </div>
  );
}
