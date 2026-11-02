import { useState } from "react";
import { applyPlan, planColoring, type PlanWithRefs } from "../automation/coloring.ts";
import { LABELS, type LabelKey } from "../automation/labels.ts";
import type { ColorRules } from "../automation/rules.ts";
import { selectCategory } from "../automation/select.ts";
import { Button } from "./Button.tsx";
import { KEY_TIMELINE_FOCUS } from "@pa/core";
import { comboTitle, labelCombo, lastKeysDiag, openKeysClient } from "../automation/keysClient.ts";
import { storageGet, storageSet } from "../env.ts";
import { updateRepo } from "../update/version.ts";

const KEYS_READY = "autoKeysReady";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  | { kind: "setup"; planned: PlanWithRefs }
  | { kind: "auto"; planned: PlanWithRefs; index: number }
  | { kind: "autoDone"; count: number; clips: number }
  | { kind: "noHelper"; planned: PlanWithRefs; oldHelper?: boolean }
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

  /** Автоматически: панель выделяет категорию, помощник жмёт Shift+3 (таймлайн) и клавишу метки. */
  const runAuto = async (planned: PlanWithRefs) => {
    let client;
    try {
      client = await openKeysClient();
    } catch {
      setState({ kind: "noHelper", planned });
      return;
    }
    if (alsoProject && planned.plan.toChange > 0) {
      try {
        await applyPlan(planned);
      } catch {
        /* не мешает покраске таймлайна */
      }
    }
    const steps = planned.plan.byCategory;
    let clips = 0;
    try {
      for (let i = 0; i < steps.length; i++) {
        setState({ kind: "auto", planned, index: i });
        const n = await selectCategory(steps[i].category, props.rules);
        if (!n) continue;
        clips += n;
        await delay(250);
        await client.send([KEY_TIMELINE_FOCUS, labelCombo(steps[i].label)]);
        await delay(200);
      }
      setState({ kind: "autoDone", count: steps.length, clips });
    } catch (err) {
      if ((err as Error)?.message === "OLD_HELPER") setState({ kind: "noHelper", planned, oldHelper: true });
      else setState({ kind: "error", message: (err as Error)?.message || String(err) });
    } finally {
      client.close();
    }
  };

  const autoStart = (planned: PlanWithRefs) => {
    if (storageGet(KEYS_READY) === "1") void runAuto(planned);
    else setState({ kind: "setup", planned });
  };

  if (state.kind === "idle" || state.kind === "error" || state.kind === "scanning") {
    return (
      <div className="hero-card">
        <div className="wiz-explain">
          <div className="wiz-explain-row">
            <span className="wiz-num">1</span>
            <span>Панель находит на таймлайне музыку, SFX, голос, видео, графику…</span>
          </div>
          <div className="wiz-explain-row">
            <span className="wiz-num">2</span>
            <span>
              И красит каждую категорию своим цветом — <b>автоматически</b>.
            </span>
          </div>
          <div className="wiz-explain-row">
            <span className="wiz-num">3</span>
            <span>Первый раз понадобится одна настройка — назначить клавиши на цвета (2 минуты).</span>
          </div>
        </div>
        {state.kind === "error" ? <div className="result result-error">{state.message}</div> : null}
        <Button variant="primary" className="wide hero-btn" onClick={scan} disabled={state.kind === "scanning"}>
          {state.kind === "scanning" ? "Анализирую таймлайн…" : "Покрасить таймлайн"}
        </Button>
        <div className="wiz-note">
          Premiere не даёт плагинам менять цвет клипов на таймлайне напрямую, поэтому клавишу цвета нажимает встроенный
          «нажиматель клавиш» — панель запускает его сама (свёрнутым окном), он выключается после закрытия Premiere. Без него — пошаговый режим вручную.
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
          <Button variant="secondary" className="confirm-btn" onClick={() => void start(state.planned)}>
            Пошагово
          </Button>
          <Button variant="primary" className="confirm-btn" onClick={() => autoStart(state.planned)}>
            Покрасить автоматически
          </Button>
        </div>
        <div className="wiz-links">
          <span className="link-small" onClick={props.onOpenRules}>
            Цвета категорий…
          </span>
          <div className="spacer" />
          {storageGet(KEYS_READY) === "1" ? (
            <span className="link-small" onClick={() => setState({ kind: "setup", planned: state.planned })}>
              Клавиши…
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  if (state.kind === "setup") {
    const labels = [...new Set(state.planned.plan.byCategory.map((c) => c.label))];
    return (
      <div className="hero-card">
        <div className="wiz-step-head">ОДИН РАЗ: КЛАВИШИ НА ЦВЕТА</div>
        <div className="wiz-instruction">
          Premiere не даёт плагинам красить клипы напрямую, поэтому помощник нажимает за вас клавишу цвета. Назначьте их:
        </div>
        <div className="wiz-setup-steps">
          <div>1. В Premiere: <b>Edit → Keyboard Shortcuts</b> (Ctrl+Alt+K).</div>
          <div>2. В поиске введите название цвета, например <b>{LABELS[labels[0]].name}</b> (раздел Edit → Label).</div>
          <div>3. Кликните в колонку Shortcut и нажмите комбинацию из списка. OK.</div>
        </div>
        {labels.map((l) => (
          <div key={l} className="plan-row">
            <Swatch label={l} />
            <span className="plan-name">{LABELS[l].name}</span>
            <div className="spacer" />
            <span className="kbd wiz-kbd">{comboTitle(labelCombo(l))}</span>
          </div>
        ))}
        <div className="field-hint">
          Также нужна стандартная клавиша Shift+3 — «перейти на таймлайн» (есть в Premiere по умолчанию). И установлен
          запущен «нажиматель клавиш» (start-keys.cmd из premiere-assistant-keys.zip — панель подскажет, если его нет).
        </div>
        <div className="confirm-actions">
          <Button variant="secondary" className="confirm-btn" onClick={() => setState({ kind: "overview", planned: state.planned })}>
            Назад
          </Button>
          <Button
            variant="primary"
            className="confirm-btn"
            onClick={() => {
              storageSet(KEYS_READY, "1");
              void runAuto(state.planned);
            }}
          >
            Назначил — покрасить
          </Button>
        </div>
      </div>
    );
  }

  if (state.kind === "noHelper") {
    return (
      <div className="hero-card">
        <div className="result result-error">Не получилось запустить «нажиматель клавиш» — без него панель не может ставить цвет клипам.</div>
        {lastKeysDiag ? <div className="field-hint">Причина: {lastKeysDiag}</div> : null}
        <div className="wiz-setup-steps">
          <div>
            1. Если Premiere спрашивал разрешение открыть файл — разрешите и нажмите <b>«Ещё раз»</b>.
          </div>
          <div>
            2. Если не спрашивал — переустановите плагин из последнего релиза (.ccx): в нём есть разрешение на автозапуск.
          </div>
          <div>
            3. Запасной вариант вручную: скачайте <b>premiere-assistant-keys.zip</b> из релиза и запустите <b>start-keys.cmd</b>.
          </div>
        </div>
        <div className="wiz-url">github.com/{updateRepo() || "Bonecrypto/premiere-assistant"}/releases/latest</div>
        <div className="confirm-actions">
          <Button variant="secondary" className="confirm-btn" onClick={() => void start(state.planned)}>
            Пошагово вручную
          </Button>
          <Button variant="primary" className="confirm-btn" onClick={() => void runAuto(state.planned)}>
            Ещё раз
          </Button>
        </div>
      </div>
    );
  }

  if (state.kind === "auto") {
    const steps = state.planned.plan.byCategory;
    const step = steps[state.index];
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
        <div className="wiz-big">
          <span className="wiz-big-swatch" style={{ backgroundColor: LABELS[step.label].swatch }} />
          <div className="wiz-big-text">
            <div className="wiz-big-title">Крашу: {step.name}</div>
            <div className="wiz-big-sub">
              {state.index + 1} из {steps.length} · {LABELS[step.label].name}
            </div>
          </div>
        </div>
        <div className="wiz-note">Не трогайте мышь и клавиатуру пару секунд.</div>
      </div>
    );
  }

  if (state.kind === "autoDone") {
    return (
      <div className="hero-card">
        <div className="result result-ok">
          Готово: категорий {state.count}, клипов {state.clips}. Отмена — Ctrl+Z в Premiere (по разу на категорию).
        </div>
        <div className="field-hint">
          Если цвет не поменялся — проверьте, что клавиши назначены (Edit → Keyboard Shortcuts) и что Shift+3 переключает на
          таймлайн.
        </div>
        <div className="confirm-actions">
          <Button variant="secondary" className="confirm-btn" onClick={() => setState({ kind: "idle" })}>
            Закрыть
          </Button>
          <Button variant="primary" className="confirm-btn" onClick={() => void scan()}>
            Ещё раз
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
