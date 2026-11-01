import { useState } from "react";
import { animateSelected } from "../automation/animate.ts";
import {
  BUILTIN_ANIMS,
  loadAnimOptions,
  loadUserAnims,
  saveAnimOptions,
  saveUserAnims,
  type AnimKind,
  type AnimOptions,
  type AnimPreset,
} from "../presets/animations.ts";
import { Button } from "./Button.tsx";
import { Section } from "./Section.tsx";
import { Segmented } from "./Segmented.tsx";

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

const SHORT: Record<string, string> = {
  "in-left": "Слева",
  "in-right": "Справа",
  "in-top": "Сверху",
  "in-bottom": "Снизу",
  "out-left": "Влево",
  "out-right": "Вправо",
  "out-top": "Вверх",
  "out-bottom": "Вниз",
};

const DIRS: Array<{ dx: number; dy: number; glyph: string }> = [
  { dx: -1, dy: -1, glyph: "↖" }, { dx: 0, dy: -1, glyph: "↑" }, { dx: 1, dy: -1, glyph: "↗" },
  { dx: -1, dy: 0, glyph: "←" }, { dx: 0, dy: 0, glyph: "●" }, { dx: 1, dy: 0, glyph: "→" },
  { dx: -1, dy: 1, glyph: "↙" }, { dx: 0, dy: 1, glyph: "↓" }, { dx: 1, dy: 1, glyph: "↘" },
];

/**
 * «Анимации»: влёт/улёт в 4 стороны, наезд/отъезд, появление/исчезновение и свои пресеты.
 * Движение — эффектом Transform с моушн-блюром (Shutter Angle 360).
 */
export function AnimationsSection(props: { onStatus(s: Status): void }) {
  const [opt, setOpt] = useState<AnimOptions>(loadAnimOptions);
  const [user, setUser] = useState<AnimPreset[]>(loadUserAnims);
  const [editing, setEditing] = useState<AnimPreset | null>(null);

  const setOption = (patch: Partial<AnimOptions>) => {
    const next = { ...opt, ...patch };
    setOpt(next);
    saveAnimOptions(next);
  };

  const apply = async (preset: AnimPreset) => {
    props.onStatus({ tone: "busy", text: `${preset.name}…` });
    try {
      const r = await animateSelected(preset, opt);
      const skip = r.skipped.length ? ` Пропущено ${r.skipped.length}: ${r.skipped[0].why}.` : "";
      props.onStatus({ tone: "ok", text: `Готово: ${preset.name} — клипов ${r.changed}. Отмена: Ctrl+Z (несколько раз).${skip}` });
    } catch (err) {
      props.onStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };

  const tile = (a: AnimPreset, label?: string) => (
    <div key={a.id} className="tile anim-tile" title={a.name} onClick={() => apply(a)}>
      <span className="anim-glyph">{a.glyph}</span>
      <span className="tile-label">{label ?? a.name}</span>
    </div>
  );

  const ins = BUILTIN_ANIMS.filter((a) => a.id.startsWith("in-"));
  const outs = BUILTIN_ANIMS.filter((a) => a.id.startsWith("out-"));
  const fx = BUILTIN_ANIMS.filter((a) => !a.id.startsWith("in-") && !a.id.startsWith("out-"));

  const saveEdit = () => {
    if (!editing) return;
    const p = { ...editing, name: editing.name.trim() || "Моя анимация" };
    const list = user.some((u) => u.id === p.id) ? user.map((u) => (u.id === p.id ? p : u)) : [...user, p];
    setUser(list);
    saveUserAnims(list);
    setEditing(null);
  };

  const remove = (id: string) => {
    const list = user.filter((u) => u.id !== id);
    setUser(list);
    saveUserAnims(list);
    setEditing(null);
  };

  return (
    <Section
      title="Анимации"
      collapsible
      plain
      footer="Выделите клипы на таймлайне и нажмите плитку. Влёт — в начале клипа, улёт — в конце. Движение делается эффектом Transform: с моушн-блюром (Shutter Angle 360) и плавностью Bezier."
    >
      <div className="group anim-options">
        <div className="anim-opt-row">
          <span className="field-label anim-opt-label">Длительность</span>
          <Segmented<string>
            className="segmented-small"
            items={["0.2", "0.3", "0.5", "1"].map((v) => ({ id: v, label: `${v} с` }))}
            value={String(opt.duration)}
            onChange={(v) => setOption({ duration: Number(v) })}
          />
        </div>
        <div className="anim-opt-row">
          <span className="field-label anim-opt-label">Расстояние</span>
          <Segmented<string>
            className="segmented-small"
            items={["50", "100", "150"].map((v) => ({ id: v, label: `${v}%` }))}
            value={String(opt.distance)}
            onChange={(v) => setOption({ distance: Number(v) })}
          />
        </div>
        <div className="anim-opt-row">
          <span className="field-label anim-opt-label">Плавность</span>
          <Segmented<"bezier" | "linear">
            className="segmented-small"
            items={[
              { id: "bezier", label: "Плавно" },
              { id: "linear", label: "Линейно" },
            ]}
            value={opt.easing}
            onChange={(v) => setOption({ easing: v })}
          />
        </div>
        <div className="anim-opt-row">
          <span className="field-label anim-opt-label">Моушн-блюр</span>
          <div className="spacer" />
          <div className={`switch${opt.blur ? " is-on" : ""}`} onClick={() => setOption({ blur: !opt.blur })} title="Transform → Shutter Angle 360">
            <div className="switch-knob" />
          </div>
        </div>
      </div>

      <div className="anim-group-title">Влёт</div>
      <div className="tiles-row">{ins.map((a) => tile(a, SHORT[a.id]))}</div>
      <div className="anim-group-title">Улёт</div>
      <div className="tiles-row">{outs.map((a) => tile(a, SHORT[a.id]))}</div>
      <div className="anim-group-title">Масштаб и прозрачность</div>
      <div className="tiles-row">{fx.map((a) => tile(a))}</div>

      <div className="anim-group-title">Мои анимации</div>
      <div className="anim-user">
        {user.map((a) => (
          <div key={a.id} className="anim-user-row">
            <div className="tile anim-user-tile" onClick={() => apply(a)} title={a.name}>
              <span className="anim-glyph">{a.glyph}</span>
              <span className="anim-user-name">{a.name}</span>
            </div>
            <span className="link-small anim-edit" onClick={() => setEditing({ ...a })}>
              изменить
            </span>
          </div>
        ))}
        {!editing ? (
          <Button
            variant="secondary"
            className="wide"
            onClick={() =>
              setEditing({ id: `u${Date.now().toString(36)}`, name: "", kind: "out", dx: 1, dy: 0, scale: 100, rotation: 0, fade: false, glyph: "→" })
            }
          >
            + Своя анимация
          </Button>
        ) : (
          <AnimEditor
            value={editing}
            onChange={setEditing}
            onSave={saveEdit}
            onCancel={() => setEditing(null)}
            onDelete={user.some((u) => u.id === editing.id) ? () => remove(editing.id) : undefined}
            onTry={() => apply(editing)}
          />
        )}
      </div>
    </Section>
  );
}

function NumberField(props: { label: string; value: number | undefined; placeholder?: string; suffix: string; onChange(v: number | undefined): void }) {
  return (
    <div className="anim-field">
      <div className="field-label">{props.label}</div>
      <div className="anim-field-row">
        <div className="input-box anim-num">
          <input
            className="text-input ai-input"
            type="text"
            placeholder={props.placeholder}
            value={props.value === undefined ? "" : String(props.value)}
            onChange={(e) => {
              const t = e.target.value.replace(",", ".").replace(/[^0-9.\-]/g, "");
              props.onChange(t === "" || t === "-" ? undefined : Number(t));
            }}
          />
        </div>
        <span className="field-hint anim-suffix">{props.suffix}</span>
      </div>
    </div>
  );
}

function AnimEditor(props: {
  value: AnimPreset;
  onChange(v: AnimPreset): void;
  onSave(): void;
  onCancel(): void;
  onDelete?: () => void;
  onTry(): void;
}) {
  const v = props.value;
  const set = (patch: Partial<AnimPreset>) => props.onChange({ ...v, ...patch });
  return (
    <div className="group anim-editor">
      <div className="field-label">Название</div>
      <div className="input-box">
        <input className="text-input ai-input" type="text" placeholder="Например: Улёт вправо с поворотом" value={v.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div className="field-label ai-gap">Когда</div>
      <Segmented<AnimKind>
        className="segmented-small"
        items={[
          { id: "in", label: "Влёт (начало)" },
          { id: "out", label: "Улёт (конец)" },
          { id: "whole", label: "Весь клип" },
        ]}
        value={v.kind}
        onChange={(kind) => set({ kind })}
      />
      <div className="anim-editor-cols">
        <div>
          <div className="field-label ai-gap">Направление</div>
          <div className="align-grid">
            {[0, 1, 2].map((r) => (
              <div key={r} className="align-row">
                {DIRS.slice(r * 3, r * 3 + 3).map((d) => (
                  <div
                    key={d.glyph}
                    className={`tile align-cell${v.dx === d.dx && v.dy === d.dy ? " is-active" : ""}`}
                    title={d.dx || d.dy ? "Направление движения" : "Без движения"}
                    onClick={() => set({ dx: d.dx, dy: d.dy, glyph: d.glyph })}
                  >
                    <span className="align-glyph">{d.glyph}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="anim-editor-side">
          <NumberField label="Масштаб в крайней точке" value={v.scale} suffix="%" onChange={(n) => set({ scale: n ?? 100 })} />
          <NumberField label="Поворот" value={v.rotation} suffix="°" onChange={(n) => set({ rotation: n ?? 0 })} />
          <NumberField label="Длительность" value={v.duration} placeholder="общая" suffix="с" onChange={(n) => set({ duration: n })} />
        </div>
      </div>
      <div className="anim-opt-row">
        <span className="field-label anim-opt-label">Растворение</span>
        <div className="spacer" />
        <div className={`switch${v.fade ? " is-on" : ""}`} onClick={() => set({ fade: !v.fade })}>
          <div className="switch-knob" />
        </div>
      </div>
      <div className="confirm-actions">
        {props.onDelete ? (
          <Button variant="plain" size="small" onClick={props.onDelete}>
            Удалить
          </Button>
        ) : null}
        <div className="spacer" />
        <Button variant="secondary" size="small" onClick={props.onCancel}>
          Отмена
        </Button>
        <Button variant="secondary" size="small" onClick={props.onTry} className="anim-try">
          Попробовать
        </Button>
        <Button variant="primary" size="small" onClick={props.onSave}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}
