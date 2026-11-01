import { useEffect, useState } from "react";
import { applyPlan, planColoring, type PlanWithRefs } from "../automation/coloring.ts";
import { selectCategory } from "../automation/select.ts";
import { LABEL_KEYS, LABELS, type LabelKey } from "../automation/labels.ts";
import { loadRules, onRulesChange, resetRules, saveRules, type CategoryId, type ColorRules } from "../automation/rules.ts";
import { Badge, Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";
import { Section } from "./Section.tsx";

type Phase =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "preview"; planned: PlanWithRefs }
  | { kind: "applying"; planned: PlanWithRefs }
  | { kind: "done"; changed: number }
  | { kind: "error"; message: string };

function Swatch({ label, size = 14 }: { label: LabelKey; size?: number }) {
  return <span className="label-swatch" style={{ width: size, height: size, backgroundColor: LABELS[label].swatch }} />;
}

/**
 * Вкладка «Авто»: рутинные действия одной кнопкой. Первая автоматизация — покраска таймлайна:
 * анализ → сводка (что и каким цветом) → подтверждение → одно действие (Ctrl+Z отменяет всё).
 */
export function AutoView() {
  const [rules, setRules] = useState<ColorRules>(loadRules);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [editing, setEditing] = useState<CategoryId | null>(null);

  // Правила могут поменяться из чата (ассистент «доучивает») — обновляем экран.
  useEffect(() => onRulesChange(setRules), []);

  const update = (fn: (r: ColorRules) => void) => {
    const copy: ColorRules = JSON.parse(JSON.stringify(rules));
    fn(copy);
    setRules(saveRules(copy));
  };

  const scan = async () => {
    setPhase({ kind: "scanning" });
    try {
      const planned = await planColoring(rules);
      setPhase({ kind: "preview", planned });
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error)?.message || String(err) });
    }
  };

  const apply = async (planned: PlanWithRefs) => {
    setPhase({ kind: "applying", planned });
    try {
      const changed = await applyPlan(planned);
      setPhase({ kind: "done", changed });
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error)?.message || String(err) });
    }
  };

  return (
    <div className="page">
      <div className="scroll-inner">
        <Section title="Покраска таймлайна" plain>
          <div className="hero-card">
            <div className="hero-head">
              <div className="hero-icon">
                <Icon name="palette" size={18} />
              </div>
              <div className="hero-text">
                <div className="row-label">Покрасить таймлайн</div>
                <div className="row-sublabel">Музыка, звуковые эффекты, голос, видео, графика — каждая своим цветом</div>
              </div>
            </div>

            {phase.kind === "idle" || phase.kind === "done" || phase.kind === "error" ? (
              <>
                {phase.kind === "done" ? (
                  <div className="result result-ok">
                    {phase.changed > 0
                      ? `Готово: перекрашено файлов — ${phase.changed}. Отменить: Ctrl+Z в Premiere.`
                      : "Файлы в проекте уже покрашены по правилам."}
                    {" "}Если клипы на таймлайне остались прежнего цвета — нажмите «Покрасить таймлайн» ещё раз и
                    «Выделить» у категории, затем правый клик по выделению → Label → цвет.
                  </div>
                ) : null}
                {phase.kind === "error" ? <div className="result result-error">{phase.message}</div> : null}
                <Button variant="primary" className="wide hero-btn" onClick={scan}>
                  Покрасить таймлайн
                </Button>
              </>
            ) : null}

            {phase.kind === "scanning" ? <div className="result">Анализирую таймлайн…</div> : null}

            {phase.kind === "preview" || phase.kind === "applying" ? (
              <PlanPreview
                rules={rules}
                planned={phase.planned}
                busy={phase.kind === "applying"}
                onCancel={() => setPhase({ kind: "idle" })}
                onApply={() => apply(phase.planned)}
              />
            ) : null}
          </div>
        </Section>

        <Section
          title="Правила"
          collapsible
          aside={
            <Button variant="plain" size="small" onClick={() => setRules(resetRules())}>
              Сбросить
            </Button>
          }
          footer="Ассистент запоминает уточнения из чата: «файлы из папки Whoosh — это SFX», «музыку крась в синий». В Premiere UXP API цвет есть у элементов проекта, поэтому красятся они — и вместе с ними клипы на таймлайне."
        >
          {rules.categories.map((c) => (
            <div key={c.id} className="rule">
              <div className="rule-row">
                <div className="rule-swatch" title="Сменить цвет" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                  <Swatch label={c.label} size={16} />
                </div>
                <div className="row-main" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                  <div className="row-label">{c.name}</div>
                  <div className="row-sublabel">
                    {LABELS[c.label].name}
                    {c.keywords.length ? ` · слов: ${c.keywords.length}` : ""}
                  </div>
                </div>
                <div
                  className={`switch${c.enabled ? " is-on" : ""}`}
                  title={c.enabled ? "Выключить категорию" : "Включить категорию"}
                  onClick={() => update((r) => {
                    const x = r.categories.find((y) => y.id === c.id)!;
                    x.enabled = !x.enabled;
                  })}
                >
                  <div className="switch-knob" />
                </div>
              </div>
              {editing === c.id ? (
                <div className="rule-edit">
                  <div className="field-label">Цвет</div>
                  <div className="label-palette">
                    {LABEL_KEYS.map((k) => (
                      <div
                        key={k}
                        title={LABELS[k].name}
                        className={`label-option${k === c.label ? " is-active" : ""}`}
                        onClick={() => update((r) => {
                          r.categories.find((y) => y.id === c.id)!.label = k;
                        })}
                      >
                        <Swatch label={k} size={14} />
                      </div>
                    ))}
                  </div>
                  {c.id !== "camera_audio" && c.id !== "video" && c.id !== "adjustment" ? (
                    <>
                      <div className="field-label">Слова в имени дорожки, клипа или файла (через запятую)</div>
                      <KeywordsInput
                        value={c.keywords}
                        onSave={(words) => update((r) => {
                          r.categories.find((y) => y.id === c.id)!.keywords = words;
                        })}
                      />
                    </>
                  ) : (
                    <div className="field-hint">Определяется автоматически по типу файла.</div>
                  )}
                </div>
              ) : null}
            </div>
          ))}
          {rules.overrides.length > 0 ? (
            <div className="rule">
              <div className="field-label">Запомненные уточнения</div>
              {rules.overrides.map((o) => (
                <div key={o.match} className="override-row">
                  <span className="mono">«{o.match}»</span>
                  <span className="override-arrow">→</span>
                  <span>{rules.categories.find((c) => c.id === o.category)?.name}</span>
                  <div className="spacer" />
                  <span
                    className="link-small"
                    onClick={() => update((r) => {
                      r.overrides = r.overrides.filter((x) => x.match !== o.match);
                    })}
                  >
                    убрать
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </Section>

        <Section title="Скоро" collapsible aside={<Badge tone="accent">Этап 2–3</Badge>} plain>
          <div className="tiles">
            <div className="tiles-row">
              <div className="tile action-tile is-soon" title="Измерить громкость и привести к −14 LUFS">
                <Icon name="wave" size={18} />
                <span className="tile-label">−14 LUFS</span>
              </div>
              <div className="tile action-tile is-soon" title="Маркеры на тишине и клиппинге">
                <Icon name="marker" size={18} />
                <span className="tile-label">Маркеры</span>
              </div>
              <div className="tile action-tile is-soon" title="Свои автоматизации: ассистент запомнит и будет повторять">
                <Icon name="bolt" size={18} />
                <span className="tile-label">Свои</span>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function PlanPreview(props: { rules: ColorRules; planned: PlanWithRefs; busy: boolean; onCancel(): void; onApply(): void }) {
  const { plan } = props.planned;
  const [selected, setSelected] = useState<string | null>(null);
  const select = async (cat: CategoryId, name: string) => {
    try {
      const n = await selectCategory(cat, props.rules);
      setSelected(`Выделено «${name}»: ${n}. На таймлайне: правый клик → Label → цвет.`);
    } catch (err) {
      setSelected((err as Error)?.message || String(err));
    }
  };
  if (plan.items.length === 0) {
    return (
      <>
        <div className="result">В секвенции «{plan.sequenceName}» нет клипов для покраски.</div>
        <Button variant="secondary" className="wide hero-btn" onClick={props.onCancel}>
          Понятно
        </Button>
      </>
    );
  }
  return (
    <div className="plan">
      <div className="plan-title">
        «{plan.sequenceName}» · клипов: {plan.totalClips}
      </div>
      {plan.byCategory.map((c) => (
        <div key={c.category} className="plan-row">
          <Swatch label={c.label} />
          <span className="plan-name">{c.name}</span>
          <div className="spacer" />
          <span className="plan-count">{c.clips} кл.</span>
          <span className="link-small plan-select" onClick={() => select(c.category, c.name)}>
            Выделить
          </span>
        </div>
      ))}
      {selected ? <div className="field-hint">{selected}</div> : null}
      {plan.items.some((i) => i.conflict) ? (
        <div className="field-hint">Один и тот же файл встречается в разных ролях — взят вариант, где его клипов больше.</div>
      ) : null}
      <div className="plan-foot">
        {plan.toChange > 0 ? `Поменяют цвет: ${plan.toChange} файл(ов). Отменяется одним Ctrl+Z.` : "Всё уже покрашено как надо."}
      </div>
      <div className="confirm-actions">
        <Button variant="secondary" className="confirm-btn" onClick={props.onCancel} disabled={props.busy}>
          Отмена
        </Button>
        <Button variant="primary" className="confirm-btn" onClick={props.onApply} disabled={props.busy || plan.toChange === 0}>
          {props.busy ? "Крашу…" : "Покрасить"}
        </Button>
      </div>
    </div>
  );
}

function KeywordsInput(props: { value: string[]; onSave(words: string[]): void }) {
  const [text, setText] = useState(props.value.join(", "));
  useEffect(() => setText(props.value.join(", ")), [props.value.join(",")]);
  const save = () =>
    props.onSave(
      text
        .split(",")
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean),
    );
  return (
    <div className="keywords">
      <textarea className="text-input keywords-input" value={text} onChange={(e) => setText(e.target.value)} onBlur={save} />
      <div className="keywords-actions">
        <Button variant="primary" size="small" onClick={save}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}
