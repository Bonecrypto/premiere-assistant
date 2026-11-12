import { useEffect, useState } from "react";
import { applyPlan, planColoring, type PlanWithRefs } from "../automation/coloring.ts";
import { selectCategory } from "../automation/select.ts";
import { diagnoseLabels } from "../automation/diagnose.ts";
import { LABEL_KEYS, LABELS, type LabelKey } from "../automation/labels.ts";
import { loadRules, onRulesChange, resetRules, saveRules, type CategoryId, type ColorRules } from "../automation/rules.ts";
import { Badge, Button } from "./Button.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Section } from "./Section.tsx";
import { TrackNamesCard } from "./TrackNamesCard.tsx";
import { BinsCard, StartProjectCard, MarkersCard, TransitionsCard } from "./AutoCards.tsx";
import { TimelineColorWizard } from "./TimelineColorWizard.tsx";
import { AutoLabelToggle } from "./AutoLabelToggle.tsx";

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
  const [diag, setDiag] = useState<string | null>(null);
  const [page, setPage] = useState<AutoPage | null>(null);

  const runDiag = async () => {
    setDiag("Собираю данные…");
    try {
      setDiag(await diagnoseLabels());
    } catch (err) {
      setDiag(`Ошибка: ${(err as Error)?.message || err}`);
    }
  };

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

  if (page) {
    const meta = PAGES[page];
    return (
      <div className="page">
        <div className="scroll-inner">
          <div className="nav-back" onClick={() => setPage(null)}>
            ‹ Авто
          </div>
          <div className="page-title">{meta.title}</div>
          <div className="page-sub">{meta.subtitle}</div>

          {page === "timeline" ? (
            <>
              <AutoLabelToggle />
              <TimelineColorWizard rules={rules} onOpenRules={() => setPage("rules")} />
              <div className="nav-link" onClick={() => setPage("rules")}>
                Правила и цвета ›
              </div>
            </>
          ) : null}
          {page === "project" ? (
            <>
              <AutoLabelToggle />
              <div className="hero-card">
            {phase.kind === "idle" || phase.kind === "done" || phase.kind === "error" ? (
              <>
                {phase.kind === "done" ? (
                  <div className="result result-ok">
                    {phase.changed > 0
                      ? `Готово: перекрашено файлов в проекте — ${phase.changed}. Отменить: Ctrl+Z в Premiere.`
                      : "Файлы в проекте уже покрашены по правилам."}
                    {" "}Клипы, которые уже лежат на таймлайне, Premiere не перекрашивает — для них есть «Покраска таймлайна».
                  </div>
                ) : null}
                {phase.kind === "error" ? <div className="result result-error">{phase.message}</div> : null}
                <Button variant="primary" className="wide hero-btn" onClick={scan}>
                  Покрасить файлы проекта
                </Button>
              </>
            ) : null}

            {phase.kind === "scanning" ? <div className="result">Анализирую проект…</div> : null}

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
              <div className="nav-link" onClick={() => setPage("rules")}>
                Правила покраски ›
              </div>
            </>
          ) : null}
          {page === "tracks" ? <TrackNamesCard bare /> : null}
          {page === "transitions" ? <TransitionsCard bare /> : null}
          {page === "markers" ? <MarkersCard bare /> : null}
          {page === "bins" ? (
            <>
              <StartProjectCard bare />
              <BinsCard />
            </>
          ) : null}
          {page === "rules" ? (
            <Section
              title="Категории"
              aside={
                <Button variant="plain" size="small" onClick={() => setRules(resetRules())}>
                  Сбросить
                </Button>
              }
              footer="Ассистент запоминает уточнения из чата: «файлы из папки Whoosh — это SFX», «музыку крась в синий»."
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
          ) : null}
          {page === "diag" ? (
            <Section footer="Показывает, какие номера цветов отдаёт ваш Premiere и какой номер стоит у каждого файла. Пришлите скриншот — по нему проверим сопоставление цветов.">
          <div className="group-actions">
            <Button variant="secondary" className="wide" onClick={runDiag}>
              Запустить диагностику
            </Button>
          </div>
          {diag ? <pre className="code-block diag-block">{diag}</pre> : null}
            </Section>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="scroll-inner">
        <div className="page-title">Авто</div>
        <div className="page-sub">Рутина одним нажатием — вы занимаетесь креативом</div>

        <div className="bento-hero" onClick={() => setPage("timeline")}>
          <div className="bento-hero-icon">
            <Icon name="palette" size={20} />
          </div>
          <div className="bento-hero-text">
            <div className="bento-hero-title">Покрасить таймлайн</div>
            <div className="bento-hero-sub">Клипы на таймлайне: музыка, SFX, голос, видео — каждая категория своим цветом</div>
          </div>
          <span className="bento-chevron">›</span>
        </div>

        <div className="bento-row">
          <BentoTile tone="green" icon="save" title="Старт проекта" sub="Папки и дорожки" onClick={() => setPage("bins")} />
          <BentoTile tone="pink" icon="palette" title="Покраска проекта" sub="Файлы в Project по категориям" onClick={() => setPage("project")} />
        </div>
        <div className="bento-row">
          <BentoTile tone="indigo" icon="fliph" title="Переходы" sub="На все стыки" onClick={() => setPage("transitions")} />
          <BentoTile tone="orange" icon="marker" title="Маркеры" sub="Склейки или интервал" onClick={() => setPage("markers")} />
        </div>
        <div className="bento-row">
          <BentoTile tone="blue" icon="tasks" title="Дорожки" sub="Назвать по содержимому" onClick={() => setPage("tracks")} />
          <BentoTile tone="purple" icon="settings" title="Правила покраски" sub={`${rules.categories.filter((c) => c.enabled).length} категорий и цвета`} onClick={() => setPage("rules")} />
        </div>

        <div className="bento-list">
          <div className="bento-list-row" onClick={() => setPage("diag")}>
            <span className="bento-list-title">Диагностика цветов</span>
            <span className="bento-list-value">›</span>
          </div>
          <div className="bento-list-row is-soon">
            <span className="bento-list-title">Громкость −14 LUFS</span>
            <span className="bento-list-value">скоро</span>
          </div>
        </div>
      </div>
    </div>
  );
}

type AutoPage = "timeline" | "project" | "tracks" | "transitions" | "markers" | "bins" | "rules" | "diag";

const PAGES: Record<AutoPage, { title: string; subtitle: string }> = {
  timeline: { title: "Покраска таймлайна", subtitle: "Клипы в секвенции — каждая категория своим цветом, автоматически." },
  project: { title: "Покраска проекта", subtitle: "Файлы в панели Project по категориям. Новые клипы с них ложатся на таймлайн уже нужным цветом. Отмена — Ctrl+Z." },
  tracks: { title: "Дорожки", subtitle: "Голос, Музыка, SFX, Видео, Графика — по тому, что на них лежит." },
  transitions: { title: "Переходы", subtitle: "На все склейки выделенных клипов. Выделите клипы (можно Ctrl+A)." },
  markers: { title: "Маркеры", subtitle: "На каждой склейке или через равные промежутки." },
  bins: { title: "Старт проекта", subtitle: "Папки проекта и имена дорожек — одним нажатием или автоматически." },
  rules: { title: "Правила покраски", subtitle: "Цвет и слова-подсказки для каждой категории." },
  diag: { title: "Диагностика цветов", subtitle: "Если цвета встают не те — пришлите скриншот отсюда." },
};

function BentoTile(props: { tone: "blue" | "indigo" | "orange" | "green" | "purple" | "pink"; icon: IconName; title: string; sub: string; onClick(): void }) {
  return (
    <div className="bento-tile" onClick={props.onClick}>
      <div className={`bento-icon grad-${props.tone}`}>
        <Icon name={props.icon} size={17} />
      </div>
      <div className="bento-title">{props.title}</div>
      <div className="bento-sub">{props.sub}</div>
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
