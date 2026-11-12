import { useMemo, useState } from "react";
import { applyFxPreset, captureFxPreset, loadFxPresets, saveFxPresets, type FxPreset } from "../automation/fxPresets.ts";
import { buildCommands, rememberCommand, searchCommands, type Command } from "../commands/registry.ts";
import { storageGet, storageSet } from "../env.ts";
import { APP_ICONS } from "./appIcons.ts";
import { FX_THUMBS } from "./fxThumbs.ts";
import { TextField } from "./TextField.tsx";
import { useSize } from "./useSize.ts";

/**
 * Вкладка «Пресеты»: самое нужное одним кликом.
 * «Мои пресеты» — эффекты, сохранённые с клипа (как пресеты Premiere), применяются к выделенным клипам.
 * «Быстрые» — любые команды панели; по умолчанию — рекомендованные, список можно менять («Изменить»).
 */

const PIN_KEY = "pinnedCommands";
/** Рекомендованные: то, что чаще всего нужно при монтаже. */
const RECOMMENDED = [
  "proj-start",
  "fx-transform-mb",
  "create-adjust-tf",
  "anim-lib-bounce-pop",
  "anim-lib-wobble",
  "hit-punch",
  "flash-bright",
  "key-launch",
  "m-gaps",
  "create-black",
  "ai-removebg",
  "txt-typewriter",
  "m-pauses",
];

function loadPins(): string[] {
  try {
    const v = JSON.parse(storageGet(PIN_KEY) || "null");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : RECOMMENDED;
  } catch {
    return RECOMMENDED;
  }
}

/** Картинка плитки: превью эффекта, иначе значок функции. */
function thumbFor(id: string): string | undefined {
  const key = id.replace(/^(fx|color|anim)-/, "");
  if (FX_THUMBS[key]) return FX_THUMBS[key];
  if (FX_THUMBS[id]) return FX_THUMBS[id];
  const alias = key.replace(/^(lib|key)-/, "");
  if (FX_THUMBS[alias]) return FX_THUMBS[alias];
  const icon: Record<string, string> = {
    "m-gaps": "gaps-blue",
    "m-markers": "marker-orange",
    "m-duration": "clock-green",
    "m-toggle": "eye-indigo",
    "m-nest": "nest-purple",
    "m-unnest": "unnest-indigo",
    "m-copy-style": "copystyle-purple",
    "m-paste-style": "pastestyle-indigo",
    "m-pauses": "cutall-pink",
    "m-subs": "title-blue",
    "m-beats": "level-orange",
    "m-cams": "camera-green",
    "snd-fades": "fade-purple",
    "snd-duck": "duck-pink",
    "proj-bins": "marker-orange",
    "proj-start": "marker-orange",
    "proj-tracks": "level-blue",
  };
  return icon[id] ? `icon:${APP_ICONS[icon[id]]}` : undefined;
}

/** Короткое имя для плитки: «Анимация: Баунс» → «Баунс». */
const short = (t: string) =>
  t
    .replace(/^(Анимация|Эффект|Цвет|Удар|Текст|Элемент|Создать|Монтаж|Звук|Ключи):\s*/i, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/…$/, "")
    .trim();

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

export function FavsView(props: { onOpenTab(tab: string): void }) {
  const cmds = useMemo(() => buildCommands(), []);
  const [pins, setPinsState] = useState<string[]>(loadPins);
  const [mine, setMine] = useState<FxPreset[]>(loadFxPresets);
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [areaRef, area] = useSize();
  const cols = Math.max(3, Math.floor(((area.w || 360) + 6) / 96));
  const tileW = Math.floor(((area.w || 360) - cols * 6) / cols);

  const setPins = (p: string[]) => {
    setPinsState(p);
    storageSet(PIN_KEY, JSON.stringify(p));
  };
  const pinned = pins.map((id) => cmds.find((c) => c.id === id)).filter(Boolean) as Command[];

  const run = async (title: string, fn: () => Promise<string>) => {
    setStatus({ tone: "busy", text: `${title}…` });
    try {
      setStatus({ tone: "ok", text: await fn() });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };

  const runCmd = (c: Command) => {
    rememberCommand(c.id);
    if (c.tab) return props.onOpenTab(c.tab);
    if (c.run) void run(short(c.title), () => c.run!((text) => setStatus({ tone: "busy", text })));
  };

  const tile = (key: string, name: string, thumb: string | undefined, onClick: () => void, extra?: React.ReactNode, hint?: string) => (
    <div key={key} className="recipe-tile fav-tile" style={{ width: tileW }} title={hint ?? name} onClick={onClick}>
      {thumb && thumb.startsWith("icon:") ? (
        <div className="recipe-thumb fav-blank" style={{ width: tileW - 6, height: Math.round(((tileW - 6) * 9) / 16) }}>
          <img className="fav-icon" src={thumb.slice(5)} alt="" />
        </div>
      ) : thumb ? (
        <img className="recipe-thumb" src={thumb} alt="" style={{ width: tileW - 6, height: Math.round(((tileW - 6) * 9) / 16) }} />
      ) : (
        <div className="recipe-thumb fav-blank" style={{ width: tileW - 6, height: Math.round(((tileW - 6) * 9) / 16) }}>
          ★
        </div>
      )}
      <div className="recipe-name">{name}</div>
      {extra}
    </div>
  );

  const found = editing && q.trim() ? searchCommands(cmds, q, 6).filter((c) => !pins.includes(c.id)) : [];

  return (
    <div className="page">
      <div className="scroll-inner" ref={areaRef}>
        <div className="fav-head">
          <span className="act-section">Мои пресеты эффектов</span>
          <div className="spacer" />
          <span className="link-small" onClick={() => setSaving(saving === null ? "" : null)}>
            + Сохранить с клипа
          </span>
        </div>
        {saving !== null ? (
          <div className="pv-save fav-save">
            <TextField className="pv-save-input" placeholder="Название (эффекты выделенного клипа)" value={saving} onChange={(v: string) => setSaving(v)} />
            <span
              className="link-small"
              onClick={() =>
                void run("Сохраняю", async () => {
                  const p = await captureFxPreset(saving.trim() || "Мой пресет", false);
                  const list = [...loadFxPresets().filter((x) => x.id !== p.id), p];
                  saveFxPresets(list);
                  setMine(list);
                  setSaving(null);
                  return `Сохранено «${p.name}»: ${p.components.length} эфф. Теперь — один клик по плитке.`;
                })
              }
            >
              Сохранить
            </span>
          </div>
        ) : null}
        <div className="recipe-grid">
          {mine.length ? (
            mine.map((f) =>
              tile(
                f.id,
                f.name,
                FX_THUMBS.mine,
                () => void run(f.name, async () => `«${f.name}» — ${(await applyFxPreset(f)).changed} клип. Отмена — Ctrl+Z.`),
                editing ? (
                  <span
                    className="fav-x"
                    title="Удалить пресет"
                    onClick={(e) => {
                      e.stopPropagation();
                      const list = mine.filter((x) => x.id !== f.id);
                      saveFxPresets(list);
                      setMine(list);
                    }}
                  >
                    ✕
                  </span>
                ) : undefined,
                `${f.name}: ${f.components.length} эфф. — клик: применить к выделенным клипам`,
              ),
            )
          ) : (
            <div className="field-hint fav-empty">
              Наложите свой пресет Premiere на клип (или настройте эффекты), выделите клип → «+ Сохранить с клипа». Дальше — один клик.
            </div>
          )}
        </div>

        <div className="fav-head">
          <span className="act-section">Быстрые</span>
          <div className="spacer" />
          <span className="link-small" onClick={() => (setEditing(!editing), setQ(""))}>
            {editing ? "Готово" : "Изменить"}
          </span>
        </div>
        {editing ? (
          <div className="fav-edit">
            <TextField value={q} placeholder="Добавить: «блюр», «баунс», «паузы»…" onChange={(v: string) => setQ(v)} />
            {found.map((c) => (
              <div key={c.id} className="palette-row" onClick={() => (setPins([...pins, c.id]), setQ(""))}>
                <span className="palette-title">+ {c.title}</span>
                <span className="palette-group">{c.group}</span>
              </div>
            ))}
            <span className="link-small fav-reset" onClick={() => setPins(RECOMMENDED)}>
              Вернуть рекомендованные
            </span>
          </div>
        ) : null}
        <div className="recipe-grid">
          {pinned.map((c) =>
            tile(
              c.id,
              short(c.title),
              thumbFor(c.id),
              () => (editing ? undefined : runCmd(c)),
              editing ? (
                <span
                  className="fav-x"
                  title="Убрать из быстрых"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPins(pins.filter((x) => x !== c.id));
                  }}
                >
                  ✕
                </span>
              ) : undefined,
              c.title,
            ),
          )}
        </div>
        <div className={`fav-status${status ? ` status-${status.tone}` : ""}`}>
          {status ? status.text : "Выделите клипы и кликните плитку — применится сразу. Отмена — Ctrl+Z."}
        </div>
      </div>
    </div>
  );
}
