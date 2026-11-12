import { useState, type ReactNode } from "react";
import { applyBins, planBins, type BinPlan } from "../automation/bins.ts";
import { addMarkers, clearMarkers, type MarkerMode } from "../automation/markers.ts";
import { loadRules } from "../automation/rules.ts";
import { addTransitions, TRANSITION_TITLE, type TransitionKind } from "../automation/transitions.ts";
import { storageGet, storageSet } from "../env.ts";
import { Button } from "./Button.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Segmented } from "./Segmented.tsx";
import { Slider } from "./Slider.tsx";
import { TextField } from "./TextField.tsx";
import {
  createProjectBins,
  DEFAULT_BIN_TEMPLATE,
  isAutoBins,
  loadBinTemplate,
  saveBinTemplate,
  setAutoBins,
} from "../automation/projectBins.ts";

/** «Папки проекта»: шаблон структуры + «Создать папки» одним нажатием + автосоздание в новом проекте. */
export function ProjectBinsCard({ bare }: { bare?: boolean } = {}) {
  const [tpl, setTplState] = useState<string[]>(loadBinTemplate);
  const [auto, setAuto] = useState(isAutoBins);
  const [add, setAdd] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const setTpl = (t: string[]) => {
    setTplState(t);
    saveBinTemplate(t);
  };
  return (
    <Card bare={bare} icon="tasks" title="Папки проекта" subtitle="Структура нового проекта одним нажатием" status={status}>
      <Button variant="primary" className="wide hero-btn" onClick={() => guard(setStatus, () => createProjectBins(tpl))}>
        Создать папки
      </Button>
      <div className="row bins-auto" onClick={() => (setAutoBins(!auto), setAuto(!auto))}>
        <div className="row-main">
          <div className="row-label">Автоматически в новом проекте</div>
          <div className="row-sublabel">Открыли пустой проект — папки появятся сами</div>
        </div>
        <span className={`toggle${auto ? " is-on" : ""}`}>{auto ? "Вкл" : "Выкл"}</span>
      </div>
      <div className="field-label">Шаблон (подпапка — через «/»)</div>
      <div className="bins-tpl">
        {tpl.map((p, i) => (
          <div key={`${p}-${i}`} className="bins-row" style={{ paddingLeft: 4 + (p.split("/").length - 1) * 16 }}>
            <span className="bins-name">{p.split("/").pop()}</span>
            <div className="spacer" />
            <span className="link-small" title="Убрать из шаблона" onClick={() => setTpl(tpl.filter((_, j) => j !== i))}>
              ✕
            </span>
          </div>
        ))}
      </div>
      <div className="pv-save">
        <TextField
          className="pv-save-input"
          placeholder="Новая папка, напр. «06 Экспорт» или «02 Аудио/Атмосфера»"
          value={add}
          onChange={(v: string) => setAdd(v)}
          onEnter={() => add.trim() && (setTpl([...tpl, add.trim()]), setAdd(""))}
        />
        <span className="link-small" onClick={() => add.trim() && (setTpl([...tpl, add.trim()]), setAdd(""))}>
          Добавить
        </span>
      </div>
      <span className="link-small bins-reset" onClick={() => setTpl([...DEFAULT_BIN_TEMPLATE])}>
        Вернуть стандартный шаблон
      </span>
    </Card>
  );
}

type Status = { tone: "ok" | "error" | "info"; text: string } | null;

function Card(props: { icon: IconName; title: string; subtitle: string; status: Status; children: ReactNode; bare?: boolean }) {
  return (
    <div className="hero-card auto-card">
      {props.bare ? null : <div className="hero-head">
        <div className="hero-icon">
          <Icon name={props.icon} size={18} />
        </div>
        <div className="hero-text">
          <div className="row-label">{props.title}</div>
          <div className="row-sublabel">{props.subtitle}</div>
        </div>
      </div>}
      {props.children}
      {props.status ? (
        <div className={`result${props.status.tone === "ok" ? " result-ok" : props.status.tone === "error" ? " result-error" : ""}`}>
          {props.status.text}
        </div>
      ) : null}
    </div>
  );
}

async function guard(set: (s: Status) => void, fn: () => Promise<string>) {
  set({ tone: "info", text: "Выполняю…" });
  try {
    set({ tone: "ok", text: await fn() });
  } catch (err) {
    set({ tone: "error", text: (err as Error)?.message || String(err) });
  }
}

/** Переходы на все стыки выделенных клипов. */
export function TransitionsCard({ bare }: { bare?: boolean } = {}) {
  const [kind, setKind] = useState<TransitionKind>(() => (storageGet("trKind") as TransitionKind) || "dissolve");
  const [seconds, setSeconds] = useState(() => Number(storageGet("trSeconds")) || 0.5);
  const [edges, setEdges] = useState(() => storageGet("trEdges") === "1");
  const [status, setStatus] = useState<Status>(null);
  return (
    <Card bare={bare} icon="fliph" title="Переходы на стыки" subtitle="На все склейки выделенных клипов — одним нажатием" status={status}>
      <div className="pv-row pv-row-stack">
        <span className="pv-label">Переход</span>
        <Segmented<TransitionKind>
          className="segmented-small"
          items={(["dissolve", "black", "white", "film"] as TransitionKind[]).map((k) => ({ id: k, label: TRANSITION_TITLE[k].replace("Плёночное растворение", "Плёнка") }))}
          value={kind}
          onChange={(k) => {
            setKind(k);
            storageSet("trKind", k);
          }}
        />
      </div>
      <Slider
        label="Длительность"
        value={seconds}
        min={0.1}
        max={2}
        step={0.05}
        unit="с"
        format={(v) => v.toFixed(2)}
        onChange={(v) => {
          setSeconds(v);
          storageSet("trSeconds", String(v));
        }}
      />
      <div className="pv-row">
        <span className="pv-label">Ещё в начале и в конце</span>
        <div className="spacer" />
        <div
          className={`switch${edges ? " is-on" : ""}`}
          onClick={() => {
            setEdges(!edges);
            storageSet("trEdges", edges ? "0" : "1");
          }}
        >
          <div className="switch-knob" />
        </div>
      </div>
      <Button
        variant="primary"
        className="wide hero-btn"
        onClick={() =>
          guard(setStatus, async () => {
            const r = await addTransitions({ kind, seconds, edges });
            return `Готово: переходов — ${r.added}. Отмена: Ctrl+Z.`;
          })
        }
      >
        Добавить переходы
      </Button>
    </Card>
  );
}

/** Маркеры на склейках или через интервал. */
export function MarkersCard({ bare }: { bare?: boolean } = {}) {
  const [mode, setMode] = useState<MarkerMode>("cuts");
  const [interval, setIntervalSec] = useState(10);
  const [status, setStatus] = useState<Status>(null);
  return (
    <Card bare={bare} icon="marker" title="Маркеры" subtitle="На каждой склейке или через равные промежутки" status={status}>
      <div className="pv-row pv-row-stack">
        <span className="pv-label">Где</span>
        <Segmented<MarkerMode>
          className="segmented-small"
          items={[
            { id: "cuts", label: "На склейках" },
            { id: "interval", label: "Через интервал" },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      {mode === "interval" ? (
        <Slider label="Интервал" value={interval} min={1} max={120} step={1} unit="с" onChange={setIntervalSec} />
      ) : null}
      <div className="auto-actions">
        <Button
          variant="secondary"
          className="auto-btn-half"
          onClick={() =>
            guard(setStatus, async () => {
              const r = await clearMarkers();
              return r.removed ? `Удалено маркеров: ${r.removed}. Отмена: Ctrl+Z.` : "Маркеров в секвенции нет.";
            })
          }
        >
          Очистить все
        </Button>
        <Button
          variant="primary"
          className="auto-btn-half"
          onClick={() =>
            guard(setStatus, async () => {
              const r = await addMarkers(mode, interval);
              return `Готово: маркеров — ${r.added}. Отмена: Ctrl+Z.`;
            })
          }
        >
          Поставить
        </Button>
      </div>
    </Card>
  );
}

/** Разложить файлы из корня проекта по папкам. */
export function BinsCard({ bare }: { bare?: boolean } = {}) {
  const [plan, setPlan] = useState<BinPlan | null>(null);
  const [status, setStatus] = useState<Status>(null);
  return (
    <Card bare={bare} icon="tasks" title="Разложить проект по папкам" subtitle="Видео, Музыка, SFX, Голос, Графика, Секвенции" status={status}>
      {plan ? (
        <div className="plan">
          {plan.byBin.length === 0 ? (
            <div className="field-hint">В корне проекта нет файлов — всё уже разложено.</div>
          ) : (
            plan.byBin.map((b) => (
              <div key={b.bin} className="plan-row">
                <span className="plan-name">{b.bin}</span>
                <div className="spacer" />
                <span className="plan-count">{b.count} шт.</span>
              </div>
            ))
          )}
          <div className="confirm-actions">
            <Button variant="secondary" className="confirm-btn" onClick={() => setPlan(null)}>
              Отмена
            </Button>
            <Button
              variant="primary"
              className="confirm-btn"
              disabled={plan.byBin.length === 0}
              onClick={() =>
                guard(setStatus, async () => {
                  const r = await applyBins(loadRules());
                  setPlan(null);
                  return `Готово: перенесено ${r.moved} в папки ${r.bins.join(", ")}. Отмена: Ctrl+Z (2 раза).`;
                })
              }
            >
              Разложить
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="field-hint auto-hint">Переносит только то, что лежит в корне проекта. Ваши папки не трогает.</div>
          <Button
            variant="primary"
            className="wide hero-btn"
            onClick={() =>
              guard(setStatus, async () => {
                const r = await planBins(loadRules());
                setPlan(r.plan);
                return r.plan.moves.length ? `Найдено файлов в корне: ${r.plan.moves.length}.` : "В корне проекта нет файлов.";
              })
            }
          >
            Посмотреть, что куда
          </Button>
        </>
      )}
    </Card>
  );
}
