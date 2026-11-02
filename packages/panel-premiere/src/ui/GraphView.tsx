import { TextField } from "./TextField.tsx";
import { useState } from "react";
import { bakeCurve, unbakeCurve, type BakeOptions } from "../automation/graph.ts";
import { storageGet, storageSet } from "../env.ts";
import {
  CURVE_PRESETS,
  curveName,
  formatCurve,
  loadLastCurve,
  loadUserCurves,
  sameCurve,
  saveLastCurve,
  saveUserCurves,
  type Curve,
  type CurvePreset,
} from "../presets/curves.ts";
import { Button } from "./Button.tsx";
import { CurveEditor, CurveThumb } from "./CurveEditor.tsx";
import { Segmented } from "./Segmented.tsx";

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

const OPT_KEY = "graphOptions";

function loadOpts(): BakeOptions {
  try {
    const v = JSON.parse(storageGet(OPT_KEY) || "null");
    if (v && (v.step === 1 || v.step === 2) && (v.scope === "all" || v.scope === "motion")) return v;
  } catch {
    /* по умолчанию */
  }
  return { step: 1, scope: "all" };
}

/**
 * Вкладка «Графики» (как графики скорости в Flow): выбрать или нарисовать кривую плавности
 * и применить её к ключевым кадрам выделенных клипов.
 */
export function GraphView() {
  const [curve, setCurveState] = useState<Curve>(loadLastCurve);
  const [user, setUser] = useState<CurvePreset[]>(loadUserCurves);
  const [opts, setOptsState] = useState<BakeOptions>(loadOpts);
  const [status, setStatus] = useState<Status>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const setCurve = (c: Curve) => {
    setCurveState(c);
    saveLastCurve(c);
  };
  const setOpts = (o: BakeOptions) => {
    setOptsState(o);
    storageSet(OPT_KEY, JSON.stringify(o));
  };

  const apply = async () => {
    setStatus({ tone: "busy", text: "Применяю график…" });
    try {
      const r = await bakeCurve(curve, opts);
      const skip = r.skipped.length ? ` Пропущено: ${r.skipped[0]}.` : "";
      setStatus({ tone: "ok", text: `Готово: клипов ${r.clips}, параметров ${r.params}, отрезков ${r.segments}. Отмена — Ctrl+Z (3 раза).${skip}` });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };

  const reset = async () => {
    setStatus({ tone: "busy", text: "Убираю график…" });
    try {
      const r = await unbakeCurve();
      setStatus({ tone: "ok", text: `Готово: убрано ключей — ${r.removed}, остались исходные с плавностью Bezier.` });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };

  const groups = ["Базовые", "Мягкие", "Резкие", "С перелётом"] as const;
  const all: Array<{ title: string; items: CurvePreset[] }> = [
    ...groups.map((g) => ({ title: g, items: CURVE_PRESETS.filter((p) => p.group === g) })),
    ...(user.length ? [{ title: "Мои", items: user }] : []),
  ];

  return (
    <div className="page">
      <div className="scroll-inner">
        <div className="page-title">Графики</div>
        <div className="page-sub">Своя плавность для ключевых кадров. Выделите клипы с анимацией, выберите кривую — «Применить».</div>

        <div className="hero-card">
          <div className="graph-head">
            <span className="graph-name">{curveName(curve)}</span>
            <div className="spacer" />
            <span className="graph-values">{formatCurve(curve)}</span>
          </div>
          <CurveEditor value={curve} onChange={setCurve} />
          <div className="graph-axis">
            <span>время →</span>
            <div className="spacer" />
            <span>↑ путь</span>
          </div>
          <div className="pv-links">
            {saving === null ? (
              <span className="link-small" onClick={() => setSaving("")}>
                + Сохранить кривую
              </span>
            ) : (
              <div className="pv-save">
                <TextField className="pv-save-input" placeholder="Название кривой" value={saving} onChange={(v: string) => setSaving(v)} />
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => {
                    const list = [...user, { id: `c${Date.now().toString(36)}`, name: saving.trim() || "Моя кривая", curve, group: "Мои" as const }];
                    setUser(list);
                    saveUserCurves(list);
                    setSaving(null);
                  }}
                >
                  Сохранить
                </Button>
              </div>
            )}
          </div>
        </div>

        {all.map((g) => (
          <div key={g.title} className="graph-group">
            <div className="pv-group">{g.title}</div>
            <div className="graph-presets">
              {g.items.map((p) => (
                <div key={p.id} className={`graph-preset${sameCurve(p.curve, curve) ? " is-active" : ""}`} onClick={() => setCurve([...p.curve] as Curve)}>
                  <CurveThumb curve={p.curve} active={sameCurve(p.curve, curve)} />
                  <div className="graph-preset-name">{p.name}</div>
                  {g.title === "Мои" ? (
                    <span
                      className="graph-preset-del"
                      title="Удалить"
                      onClick={(e) => {
                        e.stopPropagation();
                        const list = user.filter((u) => u.id !== p.id);
                        setUser(list);
                        saveUserCurves(list);
                      }}
                    >
                      ✕
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="hero-card graph-options">
          <div className="pv-row pv-row-stack">
            <span className="pv-label">Какие параметры</span>
            <Segmented<BakeOptions["scope"]>
              className="segmented-small pv-seg"
              items={[
                { id: "all", label: "Все анимированные" },
                { id: "motion", label: "Только движение" },
              ]}
              value={opts.scope}
              onChange={(scope) => setOpts({ ...opts, scope })}
            />
          </div>
          <div className="pv-row pv-row-stack">
            <span className="pv-label">Ключи</span>
            <Segmented<"1" | "2">
              className="segmented-small pv-seg"
              items={[
                { id: "1", label: "Каждый кадр" },
                { id: "2", label: "Через кадр" },
              ]}
              value={String(opts.step) as "1" | "2"}
              onChange={(s) => setOpts({ ...opts, step: s === "2" ? 2 : 1 })}
            />
          </div>
          {status ? <div className={status.tone === "busy" ? "result" : `result result-${status.tone}`}>{status.text}</div> : null}
          <div className="confirm-actions">
            <Button variant="secondary" className="confirm-btn" onClick={reset} disabled={status?.tone === "busy"}>
              Убрать график
            </Button>
            <Button variant="primary" className="confirm-btn" onClick={apply} disabled={status?.tone === "busy"}>
              Применить
            </Button>
          </div>
          <div className="wiz-note">
            Premiere не даёт плагинам двигать ручки Безье у ключей, поэтому график «запекается»: между вашими ключами ставятся
            ключи на каждом кадре точно по кривой. Ваши исходные ключи остаются — можно сменить кривую или убрать её.
          </div>
        </div>
      </div>
    </div>
  );
}
