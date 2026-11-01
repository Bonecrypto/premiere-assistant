import { useState } from "react";
import { loadRules } from "../automation/rules.ts";
import { planTrackNames, renameTracks, type TrackPlanItem } from "../automation/tracks.ts";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";

/** «Подписать дорожки»: анализ → сводка «было → станет» → применить (один Ctrl+Z). */
export function TrackNamesCard() {
  const [plan, setPlan] = useState<TrackPlanItem[] | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const analyze = async () => {
    setBusy(true);
    setStatus({ tone: "info", text: "Смотрю, что лежит на дорожках…" });
    try {
      const p = await planTrackNames(loadRules());
      setPlan(p);
      setStatus(p.length ? null : { tone: "info", text: "В секвенции нет клипов." });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const n = await renameTracks(plan.filter((p) => p.name !== p.oldName));
      setStatus({ tone: "ok", text: n ? `Готово: подписано дорожек — ${n}. Отменить: Ctrl+Z.` : "Все дорожки уже подписаны так." });
      setPlan(null);
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  const changes = plan?.filter((p) => p.name !== p.oldName).length ?? 0;

  return (
    <div className="hero-card">
      <div className="hero-head">
        <div className="hero-icon">
          <Icon name="tasks" size={18} />
        </div>
        <div className="hero-text">
          <div className="row-label">Подписать дорожки</div>
          <div className="row-sublabel">Голос, Музыка, SFX, Видео, Графика — по тому, что на них лежит</div>
        </div>
      </div>
      {status ? <div className={`result${status.tone === "ok" ? " result-ok" : status.tone === "error" ? " result-error" : ""}`}>{status.text}</div> : null}
      {plan && plan.length ? (
        <div className="plan">
          {plan.map((p) => (
            <div key={`${p.kind}${p.number}`} className="plan-row">
              <span className="plan-count track-id">{p.kind === "video" ? "V" : "A"}{p.number}</span>
              <span className="plan-name track-old">{p.oldName}</span>
              <span className="override-arrow">→</span>
              <span className={p.name !== p.oldName ? "track-new" : "track-same"}>{p.name}</span>
            </div>
          ))}
          <div className="confirm-actions">
            <Button variant="secondary" className="confirm-btn" onClick={() => setPlan(null)} disabled={busy}>
              Отмена
            </Button>
            <Button variant="primary" className="confirm-btn" onClick={apply} disabled={busy || changes === 0}>
              {changes ? `Переименовать (${changes})` : "Всё уже так"}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="primary" className="wide hero-btn" onClick={analyze} disabled={busy}>
          Подписать дорожки
        </Button>
      )}
    </div>
  );
}
