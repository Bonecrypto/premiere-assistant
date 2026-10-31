import type { TaskStatus } from "@pa/core";
import type { TaskEntry } from "../state.ts";
import { Button } from "./Button.tsx";

const STATUS: Record<TaskStatus, string> = {
  running: "выполняется",
  waiting_confirm: "ждёт подтверждения",
  done: "готово",
  error: "ошибка",
  cancelled: "отменено",
};

function time(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function TaskLog(props: { tasks: TaskEntry[]; onClear(): void }) {
  return (
    <div className="tasklog">
      <div className="tasklog-head">
        <span className="label">Лог задач</span>
        <div className="spacer" />
        <Button variant="ghost" onClick={props.onClear} disabled={props.tasks.length === 0}>
          Очистить
        </Button>
      </div>
      {props.tasks.length === 0 ? (
        <div className="hint">Пока пусто. Здесь появятся вызовы инструментов и фоновые задачи.</div>
      ) : (
        <div className="tasklog-list">
          {props.tasks.map((t) => (
            <div key={t.taskId} className={`task task-${t.status}`}>
              <div className="task-row">
                <span className="task-time">{time(t.updatedAt)}</span>
                <span className="task-title">{t.title}</span>
                <span className="task-status">
                  {STATUS[t.status]}
                  {t.status === "running" && t.progress !== undefined ? ` ${Math.round(t.progress * 100)}%` : ""}
                </span>
              </div>
              {t.detail && t.status !== "waiting_confirm" ? <div className="task-detail">{t.detail}</div> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
