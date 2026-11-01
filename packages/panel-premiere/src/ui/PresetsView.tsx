import { useEffect, useState } from "react";
import { animateSelected } from "../automation/animate.ts";
import { applyFxPreset, captureFxPreset, loadFxPresets, saveFxPresets, type FxPreset } from "../automation/fxPresets.ts";
import { applyMotion } from "../automation/motion.ts";
import { ppro } from "../automation/timeline.ts";
import { isUXP, storageGet, storageSet } from "../env.ts";
import { loadAnimOptions, loadUserAnims, saveUserAnims, type AnimPreset } from "../presets/animations.ts";
import { ALIGN_GRID, SAFE_MARGINS, type AlignAnchor, type SafeMargin } from "../presets/catalog.ts";
import { ANIM_ITEMS, FRAME_ITEMS, glyphFor, type AnimField, type AnimItem, type AnimParams, type FrameItem } from "../presets/items.ts";
import { AnimPreview } from "./AnimPreview.tsx";
import { Button } from "./Button.tsx";
import { Segmented } from "./Segmented.tsx";
import { Slider } from "./Slider.tsx";

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

/** Выбранный пункт: встроенная анимация, своя анимация или действие с кадром. */
type Selected =
  | { kind: "anim"; id: string }
  | { kind: "user"; id: string }
  | { kind: "frame"; id: string }
  | { kind: "fxnew"; id: string }
  | { kind: "fx"; id: string };

const SEL_KEY = "presetSelected";

function loadSelected(): Selected {
  try {
    const s = JSON.parse(storageGet(SEL_KEY) || "null");
    if (s && s.kind && s.id) return s;
  } catch {
    /* по умолчанию */
  }
  return { kind: "anim", id: "slide" };
}

function loadParams(item: AnimItem): AnimParams {
  try {
    const saved = JSON.parse(storageGet(`presetParams:${item.id}`) || "null");
    if (saved) return { ...item.defaults, ...saved };
  } catch {
    /* по умолчанию */
  }
  const o = loadAnimOptions();
  return { ...item.defaults, easing: o.easing, blur: item.defaults.blur && o.blur };
}

function toPreset(name: string, p: AnimParams, id = "custom"): AnimPreset {
  return {
    id,
    name,
    kind: p.kind,
    dx: p.dx,
    dy: p.dy,
    scale: p.scale,
    rotation: p.rotation,
    fade: p.fade,
    duration: p.duration,
    easing: p.easing,
    blur: p.blur,
    distance: p.distance,
    glyph: glyphFor(p),
  };
}

function fromPreset(a: AnimPreset): AnimParams {
  const o = loadAnimOptions();
  return {
    kind: a.kind,
    dx: a.dx,
    dy: a.dy,
    distance: a.distance ?? o.distance,
    scale: a.scale,
    rotation: a.rotation,
    fade: a.fade,
    duration: a.duration ?? o.duration,
    easing: a.easing ?? o.easing,
    blur: a.blur ?? o.blur,
  };
}

/** Сколько видеоклипов выделено на таймлайне (опрос раз в 1.5 с). */
function useSelectionCount(): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!isUXP) return;
    let alive = true;
    const poll = async () => {
      try {
        const project = await ppro().Project.getActiveProject();
        const seq = project ? await project.getActiveSequence() : null;
        const sel = seq ? await seq.getSelection() : null;
        const items: any[] = (sel ? await sel.getTrackItems() : []) ?? [];
        if (alive) setN(items.filter((it) => typeof it?.isAdjustmentLayer === "function").length);
      } catch {
        if (alive) setN(null);
      }
    };
    void poll();
    const t = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return n;
}

function clipsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "клип";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "клипа";
  return "клипов";
}

/**
 * Вкладка «Пресеты»: список слева (Анимация · Мои · Кадр), детали справа
 * (превью, настройки), внизу — выделение и одна кнопка «Применить».
 */
export function PresetsView() {
  const [selected, setSelectedState] = useState<Selected>(loadSelected);
  const [user, setUser] = useState<AnimPreset[]>(loadUserAnims);
  const [fx, setFx] = useState<FxPreset[]>(loadFxPresets);
  const [status, setStatus] = useState<Status>(null);
  const count = useSelectionCount();

  const select = (s: Selected) => {
    setSelectedState(s);
    storageSet(SEL_KEY, JSON.stringify(s));
    setStatus(null);
  };

  const animItem = selected.kind === "anim" ? ANIM_ITEMS.find((i) => i.id === selected.id) : undefined;
  const userItem = selected.kind === "user" ? user.find((u) => u.id === selected.id) : undefined;
  const frameItem = selected.kind === "frame" ? FRAME_ITEMS.find((i) => i.id === selected.id) : undefined;
  const fxItem = selected.kind === "fx" ? fx.find((f) => f.id === selected.id) : undefined;

  // Детали сообщают, что делать по «Применить».
  const [action, setAction] = useState<{ run: () => Promise<string> } | null>(null);

  const apply = async () => {
    if (!action) return;
    setStatus({ tone: "busy", text: "Применяю…" });
    try {
      setStatus({ tone: "ok", text: await action.run() });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };

  const saveUser = (list: AnimPreset[]) => {
    setUser(list);
    saveUserAnims(list);
  };

  return (
    <div className="pv">
      <div className="pv-body">
        <div className="pv-side">
          <div className="pv-group">Анимация</div>
          {ANIM_ITEMS.map((i) => (
            <SideItem
              key={i.id}
              title={i.title}
              subtitle={i.subtitle}
              active={selected.kind === "anim" && selected.id === i.id}
              onClick={() => select({ kind: "anim", id: i.id })}
            />
          ))}
          {user.length ? <div className="pv-group">Мои анимации</div> : null}
          {user.map((u) => (
            <SideItem
              key={u.id}
              title={u.name}
              subtitle={u.kind === "in" ? "Вход" : u.kind === "out" ? "Выход" : "Весь клип"}
              active={selected.kind === "user" && selected.id === u.id}
              onClick={() => select({ kind: "user", id: u.id })}
            />
          ))}
          <div className="pv-group">Эффекты</div>
          <SideItem
            title="+ Сохранить с клипа"
            subtitle="Эффекты и их настройки"
            active={selected.kind === "fxnew"}
            onClick={() => select({ kind: "fxnew", id: "new" })}
          />
          {fx.map((f) => (
            <SideItem
              key={f.id}
              title={f.name}
              subtitle={`${f.kind === "video" ? "Видео" : "Звук"} · ${f.components.length} эфф.`}
              active={selected.kind === "fx" && selected.id === f.id}
              onClick={() => select({ kind: "fx", id: f.id })}
            />
          ))}
          <div className="pv-group">Кадр</div>
          {FRAME_ITEMS.map((i) => (
            <SideItem
              key={i.id}
              title={i.title}
              subtitle={i.subtitle}
              active={selected.kind === "frame" && selected.id === i.id}
              onClick={() => select({ kind: "frame", id: i.id })}
            />
          ))}
        </div>

        <div className="pv-detail">
          {animItem ? (
            <AnimDetail
              key={animItem.id}
              title={animItem.title}
              fields={animItem.fields}
              initial={loadParams(animItem)}
              onParams={(p) => storageSet(`presetParams:${animItem.id}`, JSON.stringify(p))}
              setAction={setAction}
              onSaveAs={(name, p) => {
                const preset = toPreset(name, p, `u${Date.now().toString(36)}`);
                saveUser([...user, preset]);
                select({ kind: "user", id: preset.id });
              }}
            />
          ) : null}
          {userItem ? (
            <AnimDetail
              key={userItem.id}
              title={userItem.name}
              fields={["whenWhole", "side", "distance", "scale", "rotation", "fade", "duration", "easing", "blur"]}
              initial={fromPreset(userItem)}
              onParams={(p) => saveUser(user.map((u) => (u.id === userItem.id ? toPreset(u.name, p, u.id) : u)))}
              setAction={setAction}
              onDelete={() => {
                saveUser(user.filter((u) => u.id !== userItem.id));
                select({ kind: "anim", id: "slide" });
              }}
            />
          ) : null}
          {frameItem ? <FrameDetail key={frameItem.id} item={frameItem} setAction={setAction} /> : null}
          {selected.kind === "fxnew" ? (
            <FxNewDetail
              setAction={setAction}
              onSaved={(preset) => {
                setFx(loadFxPresets());
                select({ kind: "fx", id: preset.id });
              }}
            />
          ) : null}
          {fxItem ? (
            <FxDetail
              key={fxItem.id}
              preset={fxItem}
              setAction={setAction}
              onDelete={() => {
                const list = fx.filter((f) => f.id !== fxItem.id);
                setFx(list);
                saveFxPresets(list);
                select({ kind: "fxnew", id: "new" });
              }}
            />
          ) : null}
        </div>
      </div>

      <div className="pv-footer">
        <span className={`pv-footer-text${status ? ` status-${status.tone}` : ""}`}>
          {status
            ? status.text
            : count === null
              ? "Выделите клипы на таймлайне"
              : count === 0
                ? "Клипы не выделены"
                : `Выделено: ${count} ${clipsWord(count)}`}
        </span>
        <Button variant="primary" className="pv-apply" onClick={apply} disabled={!action || status?.tone === "busy"}>
          Применить
        </Button>
      </div>
    </div>
  );
}

function SideItem(props: { title: string; subtitle: string; active: boolean; onClick(): void }) {
  return (
    <div className={`pv-item${props.active ? " is-active" : ""}`} onClick={props.onClick}>
      <span className="pv-dot" />
      <div className="pv-item-text">
        <div className="pv-item-title">{props.title}</div>
        <div className="pv-item-sub">{props.subtitle}</div>
      </div>
    </div>
  );
}

const SIDES = [
  { id: "l", dx: -1, dy: 0, in: "Слева", out: "Влево" },
  { id: "r", dx: 1, dy: 0, in: "Справа", out: "Вправо" },
  { id: "t", dx: 0, dy: -1, in: "Сверху", out: "Вверх" },
  { id: "b", dx: 0, dy: 1, in: "Снизу", out: "Вниз" },
];

function AnimDetail(props: {
  title: string;
  fields: AnimField[];
  initial: AnimParams;
  onParams(p: AnimParams): void;
  setAction(a: { run: () => Promise<string> } | null): void;
  onSaveAs?: (name: string, p: AnimParams) => void;
  onDelete?: () => void;
}) {
  const [p, setP] = useState<AnimParams>(props.initial);
  const [replay, setReplay] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const has = (f: AnimField) => props.fields.includes(f);

  const update = (patch: Partial<AnimParams>) => {
    const next = { ...p, ...patch };
    setP(next);
    props.onParams(next);
  };

  // «Применить» внизу запускает анимацию с текущими настройками.
  useEffect(() => {
    props.setAction({
      run: async () => {
        const r = await animateSelected(toPreset(props.title, p), loadAnimOptions());
        const skip = r.skipped.length ? ` Пропущено ${r.skipped.length}: ${r.skipped[0].why}.` : "";
        return `Готово: ${props.title} — ${r.changed} ${clipsWord(r.changed)}. Отмена: Ctrl+Z (несколько раз).${skip}`;
      },
    });
  }, [p, props.title]);

  const side = SIDES.find((s) => s.dx === p.dx && s.dy === p.dy)?.id ?? (p.dx || p.dy ? "" : "none");

  return (
    <div className="pv-detail-inner">
      <div className="pv-head">
        <span className="pv-title">{props.title}</span>
        <div className="spacer" />
        <div className="pv-chip" onClick={() => setReplay((n) => n + 1)} title="Проиграть превью ещё раз">
          Повтор ↻
        </div>
      </div>

      <AnimPreview params={p} replayKey={replay} />

      <div className="pv-card">
        {has("when") || has("whenWhole") ? (
          <div className="pv-row pv-row-stack">
            <span className="pv-label">Когда</span>
            <Segmented<string>
              className="segmented-small pv-seg"
              items={[
                { id: "in", label: "Вход" },
                { id: "out", label: "Выход" },
                ...(has("whenWhole") ? [{ id: "whole", label: "Весь клип" }] : []),
              ]}
              value={p.kind}
              onChange={(k) => update({ kind: k as AnimParams["kind"] })}
            />
          </div>
        ) : null}
        {has("side") ? (
          <div className="pv-row pv-row-stack">
            <span className="pv-label">Направление</span>
            <Segmented<string>
              className="segmented-small pv-seg"
              items={[
                ...(props.fields.includes("scale") ? [{ id: "none", label: "Нет" }] : []),
                ...SIDES.map((s) => ({ id: s.id, label: p.kind === "in" ? s.in : s.out })),
              ]}
              value={side}
              onChange={(id) => {
                const s = SIDES.find((x) => x.id === id);
                update(s ? { dx: s.dx, dy: s.dy } : { dx: 0, dy: 0 });
              }}
            />
          </div>
        ) : null}
        {has("duration") && p.kind !== "whole" ? (
          <Slider label="Длительность" value={p.duration} min={0.1} max={2} step={0.05} unit="с" format={(v) => v.toFixed(2)} onChange={(v) => update({ duration: v })} />
        ) : null}
        {has("distance") && (p.dx || p.dy) ? (
          <Slider label="Расстояние" value={p.distance} min={10} max={200} step={5} unit="% кадра" onChange={(v) => update({ distance: v })} />
        ) : null}
        {has("scale") ? (
          <Slider
            label={p.kind === "whole" ? "Масштаб в конце" : p.kind === "in" ? "Масштаб в начале" : "Масштаб в конце"}
            value={p.scale}
            min={10}
            max={300}
            step={5}
            unit="%"
            onChange={(v) => update({ scale: v })}
          />
        ) : null}
        {has("rotation") ? (
          <Slider label="Поворот" value={p.rotation} min={-360} max={360} step={15} unit="°" onChange={(v) => update({ rotation: v })} />
        ) : null}
        {has("easing") ? (
          <div className="pv-row pv-row-stack">
            <span className="pv-label">Плавность</span>
            <Segmented<"bezier" | "linear">
              className="segmented-small pv-seg"
              items={[
                { id: "bezier", label: "Плавно" },
                { id: "linear", label: "Линейно" },
              ]}
              value={p.easing}
              onChange={(v) => update({ easing: v })}
            />
          </div>
        ) : null}
        {has("fade") ? (
          <div className="pv-row">
            <span className="pv-label">Растворение</span>
            <div className="spacer" />
            <div className={`switch${p.fade ? " is-on" : ""}`} onClick={() => update({ fade: !p.fade })}>
              <div className="switch-knob" />
            </div>
          </div>
        ) : null}
        {has("blur") ? (
          <div className="pv-row">
            <span className="pv-label">Моушн-блюр</span>
            <span className="pv-hint">Shutter 360°</span>
            <div className="spacer" />
            <div className={`switch${p.blur ? " is-on" : ""}`} onClick={() => update({ blur: !p.blur })}>
              <div className="switch-knob" />
            </div>
          </div>
        ) : null}
      </div>

      <div className="pv-links">
        {props.onSaveAs ? (
          saving === null ? (
            <span className="link-small" onClick={() => setSaving("")}>
              + Сохранить как свою
            </span>
          ) : (
            <div className="pv-save">
              <div className="input-box pv-save-input">
                <input
                  className="text-input ai-input"
                  type="text"
                  placeholder="Название, например «Мой улёт»"
                  value={saving}
                  onChange={(e) => setSaving(e.target.value)}
                />
              </div>
              <Button
                variant="primary"
                size="small"
                onClick={() => {
                  props.onSaveAs!(saving.trim() || `${props.title} — моя`, p);
                  setSaving(null);
                }}
              >
                Сохранить
              </Button>
            </div>
          )
        ) : null}
        {props.onDelete ? (
          <span className="link-small pv-delete" onClick={props.onDelete}>
            Удалить пресет
          </span>
        ) : null}
      </div>
    </div>
  );
}

function FrameDetail(props: { item: FrameItem; setAction(a: { run: () => Promise<string> } | null): void }) {
  const [anchor, setAnchor] = useState<AlignAnchor>(() => (storageGet("alignAnchor") as AlignAnchor) || "center");
  const [margin, setMargin] = useState<SafeMargin>(() => (storageGet("alignMargin") as SafeMargin) || "action");
  const { item } = props;

  useEffect(() => {
    props.setAction({
      run: async () => {
        const r = await applyMotion(item.op === "align" ? { op: "align", anchor, margin } : { op: item.op });
        const skip = r.skipped.length ? ` Пропущено ${r.skipped.length}: ${r.skipped[0].why}.` : "";
        return `Готово: ${item.title} — ${r.changed} ${clipsWord(r.changed)}. Отмена: Ctrl+Z.${skip}`;
      },
    });
  }, [item.id, anchor, margin]);

  return (
    <div className="pv-detail-inner">
      <div className="pv-head">
        <span className="pv-title">{item.title}</span>
      </div>
      <div className="pv-card">
        <div className="pv-text">{item.details}</div>
        {item.op === "align" ? (
          <div className="align-block pv-align">
            <div className="align-grid">
              {ALIGN_GRID.map((row, r) => (
                <div key={r} className="align-row">
                  {row.map((cell) => (
                    <div
                      key={cell.id}
                      title={cell.label}
                      className={`tile align-cell${cell.id === anchor ? " is-active" : ""}`}
                      onClick={() => {
                        setAnchor(cell.id);
                        storageSet("alignAnchor", cell.id);
                      }}
                    >
                      <span className="align-glyph">{cell.glyph}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="align-side">
              <div className="field-label">Положение</div>
              <div className="field-value">{ALIGN_GRID.flat().find((a) => a.id === anchor)?.label}</div>
              <div className="field-label">Отступ от края</div>
              <Segmented<SafeMargin>
                className="segmented-small"
                items={SAFE_MARGINS.map((m) => ({ id: m.id, label: m.label }))}
                value={margin}
                onChange={(m) => {
                  setMargin(m);
                  storageSet("alignMargin", m);
                }}
              />
              <div className="field-hint">{SAFE_MARGINS.find((m) => m.id === margin)?.hint}</div>
            </div>
          </div>
        ) : null}
      </div>
      <div className="pv-hint-block">Работает с выделенными видеоклипами. Отмена — Ctrl+Z.</div>
    </div>
  );
}

function FxNewDetail(props: { setAction(a: { run: () => Promise<string> } | null): void; onSaved(p: FxPreset): void }) {
  const [name, setName] = useState("");
  const [builtIn, setBuiltIn] = useState(false);

  useEffect(() => {
    props.setAction({
      run: async () => {
        const preset = await captureFxPreset(name, builtIn);
        props.onSaved(preset);
        return `Сохранено: «${preset.name}» — эффектов ${preset.components.length}.`;
      },
    });
  }, [name, builtIn]);

  return (
    <div className="pv-detail-inner">
      <div className="pv-head">
        <span className="pv-title">Сохранить эффекты с клипа</span>
      </div>
      <div className="pv-card">
        <div className="pv-text">
          Выделите на таймлайне клип, на котором эффекты уже настроены (Lumetri, Blur, Crop, DeNoise, EQ…), и нажмите
          «Применить» внизу — эффекты с настройками сохранятся как пресет.
        </div>
        <div className="pv-row pv-row-stack">
          <span className="pv-label">Название</span>
          <div className="input-box">
            <input className="text-input ai-input" type="text" placeholder="Например: Тёплый грейд + блюр" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="pv-row">
          <span className="pv-label">Вместе с Motion и Opacity</span>
          <div className="spacer" />
          <div className={`switch${builtIn ? " is-on" : ""}`} onClick={() => setBuiltIn(!builtIn)}>
            <div className="switch-knob" />
          </div>
        </div>
      </div>
      <div className="pv-hint-block">Анимированные параметры (с ключевыми кадрами) не сохраняются — только постоянные значения.</div>
    </div>
  );
}

function FxDetail(props: { preset: FxPreset; setAction(a: { run: () => Promise<string> } | null): void; onDelete(): void }) {
  const { preset } = props;
  useEffect(() => {
    props.setAction({
      run: async () => {
        const r = await applyFxPreset(preset);
        const skip = r.skippedParams ? ` Не перенесено параметров: ${r.skippedParams}.` : "";
        return `Готово: «${preset.name}» — ${r.changed} ${clipsWord(r.changed)}. Отмена: Ctrl+Z (2 раза).${skip}`;
      },
    });
  }, [preset.id]);

  return (
    <div className="pv-detail-inner">
      <div className="pv-head">
        <span className="pv-title">{preset.name}</span>
        <div className="spacer" />
        <span className="pv-hint">{preset.kind === "video" ? "для видеоклипов" : "для аудиоклипов"}</span>
      </div>
      <div className="pv-card">
        {preset.components.map((c, i) => (
          <div key={`${c.matchName}-${i}`} className="pv-row">
            <span className="pv-label">{c.displayName}</span>
            <div className="spacer" />
            <span className="pv-hint">параметров: {c.params.length}</span>
          </div>
        ))}
      </div>
      <div className="pv-links">
        <span className="pv-hint-block">Выделите клипы и нажмите «Применить».</span>
        <span className="link-small pv-delete" onClick={props.onDelete}>
          Удалить пресет
        </span>
      </div>
    </div>
  );
}
