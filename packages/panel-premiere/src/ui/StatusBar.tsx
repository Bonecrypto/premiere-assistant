import type { HelloAckMsg } from "@pa/core";
import type { HealthState } from "./Header.tsx";

const LABEL: Record<HealthState, string> = {
  ok: "Подключено",
  warn: "Нет API-ключа",
  connecting: "Подключение…",
  off: "Помощник не запущен",
};

/** Нижняя строка статуса: связь и активная секвенция слева, модель и версия справа. */
export function StatusBar(props: {
  state: HealthState;
  helper: HelloAckMsg | null;
  sequence: string | null;
  onClick(): void;
}) {
  return (
    <div className="statusbar">
      <div className="statusbar-left" onClick={props.onClick} title="Подробнее — в настройках">
        <span className={`status-dot dot-${props.state}`} />
        <span className="statusbar-text">{LABEL[props.state]}</span>
        {props.sequence ? <span className="statusbar-muted"> · {props.sequence}</span> : null}
      </div>
      <div className="spacer" />
      <span className="statusbar-muted statusbar-right">
        {props.helper ? `${props.helper.provider ?? ""} · v${props.helper.helperVersion}` : "v0.1.0"}
      </span>
    </div>
  );
}
