import { useState } from "react";
import { applyMotion, OP_TITLE, type MotionOp, type MotionRequest } from "../automation/motion.ts";
import { ALIGN_GRID, CLIP_ACTIONS, SAFE_MARGINS, type AlignAnchor, type SafeMargin } from "../presets/catalog.ts";
import { Badge, Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";
import { Section } from "./Section.tsx";
import { Segmented } from "./Segmented.tsx";

/** Строки по n элементов: UXP не поддерживает grid, а перенос flex-wrap ведёт себя нестабильно. */
function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/**
 * Вкладка «Пресеты»: выравнивание в кадре, быстрые действия с клипом и свои пресеты Effect Controls.
 * Интерфейс готов заранее; применение включится вместе с host-инструментом (этап 3).
 */
export function PresetsView() {
  const [anchor, setAnchor] = useState<AlignAnchor>("center");
  const [margin, setMargin] = useState<SafeMargin>("action");
  const marginInfo = SAFE_MARGINS.find((m) => m.id === margin)!;
  const anchorLabel = ALIGN_GRID.flat().find((a) => a.id === anchor)!.label;
  const soon = <Badge tone="accent">Скоро</Badge>;
  const [status, setStatus] = useState<{ tone: "ok" | "error" | "busy"; text: string } | null>(null);

  const run = async (req: MotionRequest) => {
    setStatus({ tone: "busy", text: `${capitalize(OP_TITLE[req.op])}…` });
    try {
      const r = await applyMotion(req);
      const skip = r.skipped.length ? ` Пропущено ${r.skipped.length}: ${r.skipped[0].why}.` : "";
      setStatus({ tone: "ok", text: `Готово: ${OP_TITLE[req.op]} — клипов ${r.changed}. Отменить: Ctrl+Z.${skip}` });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };

  return (
    <div className="page-with-footer">
      <div className="page">
        <div className="scroll-inner">
          <Section title="Выравнивание в кадре" collapsible footer="Выберите положение и нажмите «Применить» внизу — выделенные клипы встанут туда с учётом отступа.">
            <div className="align-block">
              <div className="align-grid">
                {ALIGN_GRID.map((row, r) => (
                  <div key={r} className="align-row">
                    {row.map((cell) => (
                      <div
                        key={cell.id}
                        title={cell.label}
                        className={`tile align-cell${cell.id === anchor ? " is-active" : ""}`}
                        onClick={() => setAnchor(cell.id)}
                      >
                        <span className="align-glyph">{cell.glyph}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="align-side">
                <div className="field-label">Положение</div>
                <div className="field-value">{anchorLabel}</div>
                <div className="field-label">Отступ от края</div>
                <Segmented<SafeMargin>
                  className="segmented-small"
                  items={SAFE_MARGINS.map((m) => ({ id: m.id, label: m.label }))}
                  value={margin}
                  onChange={setMargin}
                />
                <div className="field-hint">{marginInfo.hint}</div>
              </div>
            </div>
          </Section>

          <Section title="Клип" collapsible plain footer="Работает с выделенными видеоклипами на таймлайне (Effect Controls → Motion). Всё отменяется одним Ctrl+Z.">
            <div className="tiles">
              {chunk(CLIP_ACTIONS, 3).map((row, i) => (
                <div key={i} className="tiles-row">
                  {row.map((a) => (
                    <div key={a.id} className="tile action-tile" title={a.hint} onClick={() => run({ op: a.id as MotionOp })}>
                      <Icon name={a.icon} size={18} />
                      <span className="tile-label">{a.label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Мои пресеты"
            collapsible
            aside={soon}
            footer="Сохраняйте настройки Effect Controls выбранного клипа и применяйте их одним нажатием или просьбой в чате."
          >
            <div className="empty-inline">
              <div className="empty-inline-icon">
                <Icon name="star" size={16} />
              </div>
              <div className="empty-inline-text">
                <div className="row-label">Пока нет пресетов</div>
                <div className="row-sublabel">Здесь появятся ваши сохранённые настройки</div>
              </div>
            </div>
            <div className="group-actions">
              <Button variant="secondary" disabled className="wide" title="Появится на этапе 3">
                <Icon name="save" size={13} className="btn-icon" />
                Сохранить из выделенного клипа
              </Button>
            </div>
          </Section>
        </div>
      </div>

      {/* Нижняя панель действия — как в монтажных плагинах: контекст слева, главная кнопка справа. */}
      <div className="action-footer">
        <span className={`action-footer-text${status ? ` status-${status.tone}` : ""}`}>
          {status ? status.text : "Выделите клипы на таймлайне"}
        </span>
        <div className="spacer" />
        <Button variant="primary" size="small" onClick={() => run({ op: "align", anchor, margin })} title="Выровнять выделенные клипы">
          Применить
        </Button>
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
