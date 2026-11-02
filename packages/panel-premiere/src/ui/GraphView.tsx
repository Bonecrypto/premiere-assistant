import { TextField } from "./TextField.tsx";
import { useState } from "react";
import { applyQuickEase, bakeCurve, unbakeCurve, type BakeOptions, type QuickEase } from "../automation/graph.ts";
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

const QUICK: Array<{ id: QuickEase; name: string; curve: Curve; hint: string; beta?: boolean }> = [
  { id: "bezier", name: "Плавно", curve: [0.33, 0, 0.67, 1], hint: "Bezier — как «Bezier» в меню ключа" },
  { id: "linear", name: "Линейно", curve: [0, 0, 1, 1], hint: "Linear — ровная скорость" },
  { id: "easy-ease", name: "Easy Ease", curve: [0.42, 0, 0.58, 1], hint: "Первый ключ — Ease Out, последний — Ease In", beta: true },
  { id: "ease-out", name: "Ease Out", curve: [0, 0, 0.58, 1], hint: "Мягкий выход из ключа", beta: true },
  { id: "ease-in", name: "Ease In", curve: [0.42, 0, 1, 1], hint: "Мягкий вход в ключ", beta: true },
  { id: "hold", name: "Ступенька", curve: [0, 0, 1, 1], hint: "Hold — значение держится до следующего ключа" },
];

/** Миниатюра «ступеньки» (Hold). */
function HoldThumb() {
  return (
    <div className="curve-thumb">
      <span className="hold-a" />
      <span className="hold-b" />
      <span className="hold-c" />
    </div>
  );
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

  const [quickStatus, setQuickStatus] = useState<Status>(null);
  const [lastQuick, setLastQuick] = useState<QuickEase | null>(null);
  const quick = async (id: QuickEase, name: string) => {
    setLastQuick(id);
    setQuickStatus({ tone: "busy", text: `Ставлю «${name}»…` });
    try {
      const r = await applyQuickEase(id, opts.scope);
      setQuickStatus({ tone: "ok", text: `«${name}»: ключей ${r.keys} у ${r.params} параметров (${r.clips} клип.). Новых ключей нет. Отмена — Ctrl+Z.` });
    } catch (err) {
      setQuickStatus({ tone: "error", text: (err as Error)?.message || String(err) });
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
        <div className="page-sub">Выделите клипы с ключевыми кадрами и выберите плавность.</div>

        <div className="hero-card quick-ease">
          <div className="quick-head">
            <span className="graph-name">Быстро</span>
            <span className="quick-sub">без новых ключей — меняет тип ваших ключей в Effect Controls</span>
          </div>
          <div className="quick-row">
            {QUICK.map((q) => (
              <div
                key={q.id}
                className={`graph-preset quick-tile${lastQuick === q.id ? " is-active" : ""}`}
                title={q.hint}
                onClick={() => void quick(q.id, q.name)}
              >
                {q.id === "hold" ? <HoldThumb /> : <CurveThumb curve={q.curve} active={lastQuick === q.id} />}
                <div className="graph-preset-name">{q.name}</div>
                {q.beta ? <span className="quick-beta">проверить</span> : null}
              </div>
            ))}
          </div>
          {quickStatus ? <div className={quickStatus.tone === "busy" ? "result" : `result result-${quickStatus.tone}`}>{quickStatus.text}</div> : null}
        </div>

        <div className="pv-group graph-own-title">Свой график (точная кривая — добавляет ключи на каждом кадре)</div>

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
