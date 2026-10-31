import type { TaskStatus } from "@pa/core";
import type { TaskEntry } from "../state.ts";
import { Button, IconTile } from "./Button.tsx";
import { Section } from "./Section.tsx";

const STATUS: Record<TaskStatus, { text: string; glyph: string; tone: "blue" | "orange" | "green" | "gray" | "purple" }> = {
  running: { text: "Выполняется", glyph: "↻", tone: "blue" },
  waiting_confirm: { text: "Ждёт подтверждения", glyph: "?", tone: "orange" },
  done: { text: "Готово", glyph: "✓", tone: "green" },
  error: { text: "Ошибка", glyph: "!", tone: "orange" },
  cancelled: { text: "Отменено", glyph: "–", tone: "gray" },
};

function time(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Вкладка «Задачи»: всё, что ассистент делает или сделал, с понятным статусом. */
export function TasksView(props: { tasks: TaskEntry[]; onClear(): void }) {
  const active = props.tasks.filter((t) => t.status === "running" || t.status === "waiting_confirm");
  const finished = props.tasks.filter((t) => !(t.status === "running" || t.status === "waiting_confirm"));

  if (props.tasks.length === 0) {
    return (
      <div className="page page-center">
        <div className="empty">
          <div className="empty-mark empty-mark-muted">✓</div>
          <div className="empty-title">Задач нет</div>
          <div className="empty-text">Здесь появятся действия ассистента и долгие фоновые задачи с прогрессом.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {active.length > 0 ? (
        <Section title="Сейчас">
          {active.map((t) => (
            <TaskRow key={t.taskId} t={t} />
          ))}
        </Section>
      ) : null}
      {finished.length > 0 ? (
        <Section
          title="Недавние"
          aside={
            <Button variant="plain" size="small" onClick={props.onClear}>
              Очистить
            </Button>
          }
        >
          {finished.map((t) => (
            <TaskRow key={t.taskId} t={t} />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function TaskRow({ t }: { t: TaskEntry }) {
  const s = STATUS[t.status];
  const showDetail = t.detail && t.status !== "waiting_confirm";
  return (
    <div className="row">
      <div className="row-icon">
        <IconTile glyph={s.glyph} tone={s.tone} />
      </div>
      <div className="row-main">
        <div className="row-label mono">{t.title}</div>
        <div className="row-sublabel">
          {s.text}
          {t.status === "running" && t.progress !== undefined ? ` · ${Math.round(t.progress * 100)}%` : ""}
          {showDetail ? ` · ${t.detail}` : ""}
        </div>
        {t.status === "running" && t.progress !== undefined ? (
          <div className="progress">
            <div className="progress-fill" style={{ width: `${Math.round(t.progress * 100)}%` }} />
          </div>
        ) : null}
      </div>
      <div className="row-value muted">{time(t.updatedAt)}</div>
    </div>
  );
}
