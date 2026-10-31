import { useState } from "react";
import { ALIGN_GRID, SAFE_MARGINS, type AlignAnchor, type SafeMargin } from "../presets/catalog.ts";
import { Badge, Button, IconTile } from "./Button.tsx";
import { Section } from "./Section.tsx";
import { Segmented } from "./Segmented.tsx";

/**
 * Вкладка «Пресеты»: выравнивание клипов в кадре и собственные пресеты Effect Controls.
 * Интерфейс готов заранее; кнопки применения включатся, когда появится host-инструмент.
 */
export function PresetsView() {
  const [anchor, setAnchor] = useState<AlignAnchor>("center");
  const [margin, setMargin] = useState<SafeMargin>("action");
  const marginInfo = SAFE_MARGINS.find((m) => m.id === margin)!;
  const anchorLabel = ALIGN_GRID.flat().find((a) => a.id === anchor)!.label;

  return (
    <div className="page">
      <Section
        title="Выравнивание в кадре"
        aside={<Badge tone="accent">Скоро</Badge>}
        footer="Двигает выделенные клипы через Effect Controls → Motion (Position). Перед изменением покажу, что именно поменяется."
      >
        <div className="align-block">
          <div className="align-grid">
            {ALIGN_GRID.map((row, r) => (
              <div key={r} className="align-row">
                {row.map((cell) => (
                  <div
                    key={cell.id}
                    title={cell.label}
                    className={`align-cell${cell.id === anchor ? " is-active" : ""}`}
                    onClick={() => setAnchor(cell.id)}
                  >
                    {cell.glyph}
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
        <div className="group-actions">
          <Button variant="primary" disabled className="wide" title="Появится на этапе 3">
            Применить к выделенным клипам
          </Button>
        </div>
      </Section>

      <Section
        title="Мои пресеты"
        aside={<Badge tone="accent">Скоро</Badge>}
        footer="Сохраняйте настройки Effect Controls выбранного клипа (масштаб, позиция, эффекты) и применяйте их одним нажатием или просьбой в чате."
      >
        <div className="empty-inline">
          <IconTile glyph="★" tone="purple" />
          <div className="empty-inline-text">
            <div className="row-label">Пока нет пресетов</div>
            <div className="row-sublabel">Здесь появятся ваши сохранённые настройки</div>
          </div>
        </div>
        <div className="group-actions">
          <Button variant="secondary" disabled className="wide" title="Появится на этапе 3">
            Сохранить настройки выделенного клипа
          </Button>
        </div>
      </Section>
    </div>
  );
}
