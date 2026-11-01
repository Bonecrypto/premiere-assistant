import { useEffect, useState } from "react";
import { isAutoLabelOn, onAutoLabeled, setAutoLabel } from "../automation/autoLabel.ts";

/** Переключатель «Автопокраска новых файлов» + что покрашено последним. */
export function AutoLabelToggle() {
  const [on, setOn] = useState(isAutoLabelOn);
  const [last, setLast] = useState<string | null>(null);

  useEffect(
    () =>
      onAutoLabeled((n, names) =>
        setLast(`Покрашено новых: ${n} — ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}`),
      ),
    [],
  );

  return (
    <div className="hero-card auto-label">
      <div className="pv-row">
        <div className="auto-label-text">
          <div className="auto-label-title">Автопокраска новых файлов</div>
          <div className="auto-label-sub">
            Импортировали музыку или SFX — файл сразу получает свой цвет, и клипы с него ложатся на таймлайн уже покрашенными.
          </div>
        </div>
        <div
          className={`switch${on ? " is-on" : ""}`}
          onClick={() => {
            setAutoLabel(!on);
            setOn(!on);
          }}
        >
          <div className="switch-knob" />
        </div>
      </div>
      {on && last ? <div className="field-hint">{last}</div> : null}
    </div>
  );
}
