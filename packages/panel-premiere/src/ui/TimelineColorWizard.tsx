import { useState } from "react";
import { applyPlan, planColoring, type PlanWithRefs } from "../automation/coloring.ts";
import { LABELS, type LabelKey } from "../automation/labels.ts";
import type { ColorRules } from "../automation/rules.ts";
import { selectCategory } from "../automation/select.ts";
import { Button } from "./Button.tsx";

/**
 * Покраска клипов на таймлайне — пошагово.
 * Premiere API (и UXP, и старый ExtendScript) не умеет менять цвет клипа на таймлайне — только цвет файла в проекте.
 * Поэтому панель сама выделяет клипы каждой категории, а пользователь назначает цвет одним действием
 * (правый клик → Label → цвет или своя горячая клавиша). Заодно (по желанию) красим файлы в проекте.
 */

type Step = PlanWithRefs["plan"]["byCategory"][number];

type State =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "overview"; planned: PlanWithRefs }
  | { kind: "step"; planned: PlanWithRefs; index: number; selected: number | null; error?: string }
  | { kind: "done"; count: number }
  | { kind: "error"; message: string };

function Swatch({ label, size = 14 }: { label: LabelKey; size?: number }) {
  return <span className="label-swatch" style={{ width: size, height: size, backgroundColor: LABELS[label].swatch }} />;
}

export function TimelineColorWizard(props: { rules: ColorRules; onOpenRules(): void }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [alsoProject, setAlsoProject] = useState(true);

  const scan = async () => {
    setState({ kind: "scanning" });
    try {
      const planned = await planColoring(props.rules);
      setState({ kind: "overview", planned });
    } catch (err) {
      setState({ kind: "error", message: (err as Error)?.message || String(err) });
    }
  };

  const goto = async (planned: PlanWithRefs, index: number) => {
    const steps = planned.plan.byCategory;
    if (index >= steps.length) {
      setState({ kind: "done", count: steps.length });
      return;
    }
    setState({ kind: "step", planned, index, selected: null });
    try {
      const n = await selectCategory(steps[index].category, props.rules);
      setState({ kind: "step", planned, index, selected: n });
    } catch (err) {
      setState({ kind: "step", planned, index, selected: 0, error: (err as Error)?.message || String(err) });
    }
  };

  const start = async (planned: PlanWithRefs) => {
    if (alsoProject && planned.plan.toChange > 0) {
      try {
        await applyPlan(planned);
      } catch {
        /* покраска файлов — дополнительная, не мешает шагам */
      }
    }
    await goto(planned, 0);
  };

  if (state.kind === "idle" || state.kind === "error" || state.kind === "scanning") {
    return (
      <div className="hero-card">
        <div className="wiz-explain">
          <div className="wiz-explain-row">
            <span className="wiz-num">1</span>
            <span>Панель выделяет на таймлайне клипы одной категории — музыку, SFX, голос…</span>
          </div>
          <div className="wiz-explain-row">
            <span className="wiz-num">2</span>
            <span>
              <b>Цвет ставите вы</b>: правый клик по выделению → <b>Label</b> → цвет. Сама панель цвет клипа поменять не может.
            </span>
          </div>
          <div className="wiz-explain-row">
            <span className="wiz-num">3</span>
            <span>«Дальше» — следующая категория. Пара секунд на категорию.</span>
          </div>
        </div>
        {state.kind === "error" ? <div className="result result-error">{state.message}</div> : null}
        <Button variant="primary" className="wide hero-btn" onClick={scan} disabled={state.kind === "scanning"}>
          {state.kind === "scanning" ? "Анализирую таймлайн…" : "Начать"}
        </Button>
        <div className="wiz-note">
          Premiere не даёт плагинам менять цвет клипов на таймлайне напрямую — только цвет файлов в проекте. Поэтому
          цвет ставите вы, а всю работу по поиску и выделению делает панель.
        </div>
      </div>
    );
  }

  if (state.kind === "overview") {
    const { plan } = state.planned;
    if (plan.byCategory.length === 0) {
      return (
        <div className="hero-card">
          <div className="result">В секвенции «{plan.sequenceName}» нет клипов для покраски.</div>
          <Button variant="secondary" className="wide hero-btn" onClick={() => setState({ kind: "idle" })}>
            Понятно
          </Button>
        </div>
      );
    }
    return (
      <div className="hero-card">
        <div className="plan-title">
          «{plan.sequenceName}» · клипов: {plan.totalClips}
        </div>
        {plan.byCategory.map((c) => (
          <div key={c.category} className="plan-row">
            <Swatch label={c.label} />
            <span className="plan-name">{c.name}</span>
            <div className="spacer" />
            <span className="plan-count">{c.clips} кл.</span>
            <span className="wiz-label-name">{LABELS[c.label].name}</span>
          </div>
        ))}
        <div className="pv-row wiz-toggle">
          <span className="pv-label">Заодно покрасить файлы в проекте</span>
          <div className="spacer" />
          <div className={`switch${alsoProject ? " is-on" : ""}`} onClick={() => setAlsoProject(!alsoProject)}>
            <div className="switch-knob" />
          </div>
        </div>
        <div className="field-hint">Тогда новые клипы с этих файлов сразу лягут нужным цветом.</div>
        <div className="confirm-actions">
          <Button variant="secondary" className="confirm-btn" onClick={props.onOpenRules}>
            Цвета…
          </Button>
          <Button variant="primary" className="confirm-btn" onClick={() => void start(state.planned)}>
            Поехали ›
          </Button>
        </div>
      </div>
    );
  }

  if (state.kind === "step") {
    const steps = state.planned.plan.byCategory;
    const step: Step = steps[state.index];
    const last = state.index === steps.length - 1;
    return (
      <div className="hero-card">
        <div className="wiz-progress">
          {steps.map((s, i) => (
            <span
              key={s.category}
              className={`wiz-dot${i === state.index ? " is-current" : i < state.index ? " is-done" : ""}`}
              style={i <= state.index ? { backgroundColor: LABELS[s.label].swatch } : undefined}
            />
          ))}
        </div>
        <div className="wiz-step-head">Шаг {state.index + 1} из {steps.length}</div>

        <div className="wiz-big">
          <span className="wiz-big-swatch" style={{ backgroundColor: LABELS[step.label].swatch }} />
          <div className="wiz-big-text">
            <div className="wiz-big-title">{step.name}</div>
            <div className="wiz-big-sub">
              {state.selected === null ? "Выделяю клипы…" : state.error ? state.error : `Выделено клипов: ${state.selected}`}
            </div>
          </div>
        </div>

        <div className="wiz-instruction-box">
          <div className="wiz-instruction-title">ТЕПЕРЬ ВЫ — В PREMIERE</div>
          <div className="wiz-instruction">
            Правый клик по выделенным клипам на таймлайне → <b>Label</b> → <b>{LABELS[step.label].name}</b>. Потом вернитесь
            сюда и нажмите «Покрасил — дальше».
          </div>
        </div>

        <div className="confirm-actions">
          <Button variant="secondary" className="confirm-btn" onClick={() => void goto(state.planned, state.index)}>
            Выделить снова
          </Button>
          <Button variant="primary" className="confirm-btn" onClick={() => void goto(state.planned, state.index + 1)}>
            {last ? "Покрасил — готово" : "Покрасил — дальше ›"}
          </Button>
        </div>
        <div className="wiz-links">
          {state.index > 0 ? (
            <span className="link-small" onClick={() => void goto(state.planned, state.index - 1)}>
              ‹ Назад
            </span>
          ) : (
            <span />
          )}
          <div className="spacer" />
          <span className="link-small" onClick={() => setState({ kind: "idle" })}>
            Прервать
          </span>
        </div>
        <div className="wiz-note">
          Быстрее: назначьте горячие клавиши на цвета — Edit → Keyboard Shortcuts, в поиске «Label». Тогда каждый шаг —
          одно нажатие.
        </div>
      </div>
    );
  }

  return (
    <div className="hero-card">
      <div className="result result-ok">Готово! Прошли категорий: {state.count}. Если какие-то клипы остались прежнего цвета — значит, на этом шаге Label не поставили: пройдите ещё раз.</div>
      <Button variant="secondary" className="wide hero-btn" onClick={() => void scan()}>
        Пройти ещё раз
      </Button>
    </div>
  );
}
