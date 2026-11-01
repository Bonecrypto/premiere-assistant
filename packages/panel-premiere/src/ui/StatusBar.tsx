import type { HelloAckMsg } from "@pa/core";
import type { HealthState } from "./Header.tsx";
import type { UpdateInfo } from "../update/updater.ts";

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
  update?: UpdateInfo | null;
  onUpdateClick?(): void;
}) {
  return (
    <div className="statusbar">
      <div className="statusbar-left" onClick={props.onClick} title="Подробнее — в настройках">
        <span className={`status-dot dot-${props.state}`} />
        <span className="statusbar-text">{LABEL[props.state]}</span>
        {props.sequence ? <span className="statusbar-muted"> · {props.sequence}</span> : null}
      </div>
      <div className="spacer" />
      {props.update ? (
        <span className="statusbar-update" onClick={props.onUpdateClick} title="Открыть «Настройки → Обновления»">
          Обновление v{props.update.version} ↑
        </span>
      ) : null}
      <span className="statusbar-muted statusbar-right">
        {props.helper ? `${props.helper.provider ?? ""} · v${props.helper.helperVersion}` : `v${(window as any).__paRunningVersion ?? __APP_VERSION__}`}
      </span>
    </div>
  );
}
