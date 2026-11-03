import { useState } from "react";
import { KEY_ADD_EDIT, KEY_ADD_EDIT_ALL, KEY_TIMELINE_FOCUS } from "@pa/core";
import { openKeysClient, lastKeysDiag } from "../automation/keysClient.ts";
import { nestSelected, unnestSelected } from "../automation/nest.ts";
import { copyStyle, lastDiag, pasteStyle } from "../automation/textStyle.ts";
import { cutPauses, findPauses, type PausePlan } from "../automation/silence.ts";
import { Button } from "./Button.tsx";
import { closeGaps, placeOnMarkers, setDuration, toggleEnabled } from "../automation/montage.ts";
import { changeLevel, duckMusic, fades } from "../automation/sound.ts";
import { storageGet, storageSet } from "../env.ts";
import { APP_ICONS } from "./appIcons.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Slider } from "./Slider.tsx";

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

function useStatus(): [Status, (busy: string, fn: () => Promise<string>) => Promise<void>, (text: string) => void] {
  const [status, setStatus] = useState<Status>(null);
  const run = async (busy: string, fn: () => Promise<string>) => {
    setStatus({ tone: "busy", text: busy });
    try {
      setStatus({ tone: "ok", text: await fn() });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };
  const report = (text: string) => setStatus({ tone: "busy", text });
  return [status, run, report];
}

/** Плитка-действие: иконка в цветном квадрате + подпись. */
function Act(props: { icon: IconName; grad: string; label: string; hint: string; onClick(): void }) {
  return (
    <div className="act-tile" title={props.hint} onClick={props.onClick}>
      {APP_ICONS[`${props.icon}-${props.grad}`] ? (
        <img className="act-img" src={APP_ICONS[`${props.icon}-${props.grad}`]} alt="" />
      ) : (
        <div className={`act-icon grad-${props.grad}`}>
          <Icon name={props.icon} size={18} />
        </div>
      )}
      <div className="act-label">{props.label}</div>
    </div>
  );
}

/** Маленький переключатель-чип для настроек. */
function Chip(props: { label: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <div className={`lib-chip act-chip${props.value ? " is-active" : ""}`} onClick={() => props.onChange(!props.value)}>
      {props.value ? "✓ " : ""}
      {props.label}
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return <div className={status.tone === "busy" ? "result tool-status" : `result result-${status.tone} tool-status`}>{status.text}</div>;
}

const skippedNote = (s: string[]) => (s.length ? ` Пропущено: ${s.slice(0, 2).join("; ")}.` : "");

/** Вкладка «Монтаж»: всё на одном экране — плитки с иконками, настройки внизу. */
export function MontageView() {
  const [status, run, report] = useStatus();
  const [trim, setTrim] = useState(() => storageGet("montageTrim") !== "0");
  const [dur, setDur] = useState(() => Number(storageGet("montageDur")) || 2);
  const [pack, setPack] = useState(() => storageGet("montagePack") !== "0");
  const [diag, setDiag] = useState("");
  const [pauseOpen, setPauseOpen] = useState(false);
  const [plan, setPlan] = useState<PausePlan | null>(null);
  const [noise, setNoise] = useState(() => Number(storageGet("pauseNoise")) || -38);
  const [minPause, setMinPause] = useState(() => Number(storageGet("pauseMin")) || 0.5);
  const [pad, setPad] = useState(() => Number(storageGet("pausePad") ?? "0.1") || 0.1);

  const cut = (all: boolean) =>
    run("Режу…", async () => {
      let client;
      try {
        client = await openKeysClient();
      } catch {
        throw new Error(`Нужна программа-нажиматель (как для покраски таймлайна). ${lastKeysDiag}`);
      }
      try {
        await client.send([KEY_TIMELINE_FOCUS, all ? KEY_ADD_EDIT_ALL : KEY_ADD_EDIT]);
      } finally {
        client.close();
      }
      return all ? "Разрезал все дорожки под плейхедом. Отмена — Ctrl+Z." : "Разрезал выбранные дорожки под плейхедом. Отмена — Ctrl+Z.";
    });

  return (
    <div className="page">
      <div className="scroll-inner act-page">
        <StatusLine status={status} />
        <div className="act-section">Авто</div>
        <div className="act-grid">
          <Act icon="cutall" grad="pink" label="Вырезать паузы" hint="Найти тишину в выделенном клипе с речью и вырезать — эффекты клипа сохраняются" onClick={() => setPauseOpen(!pauseOpen)} />
        </div>
        {pauseOpen ? (
          <div className="act-settings">
            <Slider label="Тишина — тише чем" value={noise} min={-60} max={-20} step={1} unit="дБ" onChange={(v) => (setNoise(v), storageSet("pauseNoise", String(v)), setPlan(null))} />
            <Slider label="Пауза от" value={minPause} min={0.2} max={2} step={0.1} unit="с" format={(v) => v.toFixed(1)} onChange={(v) => (setMinPause(v), storageSet("pauseMin", String(v)), setPlan(null))} />
            <Slider label="Запас вокруг речи" value={pad} min={0} max={0.4} step={0.02} unit="с" format={(v) => v.toFixed(2)} onChange={(v) => (setPad(v), storageSet("pausePad", String(v)), setPlan(null))} />
            {plan ? (
              <div className="pause-plan">
                Найдено пауз: <b>{plan.pauses}</b> — вырежется {plan.removed.toFixed(1)} с из {(plan.end - plan.start).toFixed(1)} с.
              </div>
            ) : null}
            <div className="confirm-actions">
              <Button
                variant="secondary"
                className="confirm-btn"
                onClick={() =>
                  void run("Ищу паузы…", async () => {
                    const r = await findPauses({ noise, min: minPause, pad }, (t) => report(t));
                    setPlan(r);
                    return r.pauses ? `Найдено пауз: ${r.pauses} (${r.removed.toFixed(1)} с). Проверьте настройки и нажмите «Вырезать».` : "Пауз не найдено — попробуйте порог тише (например −45 дБ).";
                  })
                }
              >
                Найти
              </Button>
              <Button
                variant="primary"
                className="confirm-btn"
                disabled={!plan || !plan.pauses}
                onClick={() =>
                  plan &&
                  void run("Вырезаю паузы…", async () => {
                    const r = await cutPauses(plan, (t) => report(t));
                    setPlan(null);
                    return r;
                  })
                }
              >
                Вырезать
              </Button>
            </div>
          </div>
        ) : null}
        <div className="act-section">Текст</div>
        <div className="act-grid">
          <Act
            icon="copystyle"
            grad="purple"
            label="Копировать стиль"
            hint="С самого раннего выделенного слоя: шрифт, размер, заливка, обводка, позиция, масштаб"
            onClick={() =>
              void run("Копирую стиль…", async () => {
                const r = await copyStyle();
                setDiag(lastDiag);
                return r;
              })
            }
          />
          <Act icon="pastestyle" grad="indigo" label="Вставить стиль" hint="На все выделенные слои — текст каждого остаётся своим" onClick={() => void run("Вставляю стиль…", () => pasteStyle())} />
        </div>
        <div className="act-section">Монтаж</div>
        <div className="act-grid">
          <Act icon="nest" grad="purple" label="Nest" hint="Собрать выделенное во вложенную секвенцию (эффекты сохраняются)" onClick={() => void run("Собираю Nest…", () => nestSelected())} />
          <Act icon="unnest" grad="indigo" label="Разобрать Nest" hint="Разложить выделенный Nest обратно (эффекты внутренних клипов не переносятся)" onClick={() => void run("Разбираю…", () => unnestSelected())} />
          <Act icon="scissors" grad="pink" label="Разрез" hint="Ctrl+K под плейхедом на выбранных дорожках" onClick={() => void cut(false)} />
          <Act icon="cutall" grad="pink" label="Разрез всех" hint="Ctrl+Shift+K — все дорожки под плейхедом" onClick={() => void cut(true)} />
          <Act
            icon="gaps"
            grad="blue"
            label="Убрать пустоты"
            hint="Выделенные клипы встают вплотную (на каждой дорожке)"
            onClick={() =>
              void run("Сдвигаю…", async () => {
                const r = await closeGaps();
                return `Сдвинуто клипов: ${r.changed}.${skippedNote(r.skipped)}`;
              })
            }
          />
          <Act
            icon="marker"
            grad="orange"
            label="По маркерам"
            hint="Клипы по порядку встают на маркеры секвенции (под биты)"
            onClick={() =>
              void run("Раскладываю…", async () => {
                const r = await placeOnMarkers(trim);
                return `Разложено клипов: ${r.changed}.${skippedNote(r.skipped)}`;
              })
            }
          />
          <Act
            icon="clock"
            grad="green"
            label={`Длина ${dur.toFixed(1)} с`}
            hint="Все выделенные клипы — одной длительности"
            onClick={() =>
              void run("Меняю длительность…", async () => {
                const r = await setDuration(dur, pack);
                return `Длительность ${dur.toFixed(1)} с — клипов: ${r.changed}.`;
              })
            }
          />
          <Act
            icon="eye"
            grad="indigo"
            label="Вкл / выкл"
            hint="Как Shift+E: клипы остаются, но не видны и не слышны"
            onClick={() =>
              void run("…", async () => {
                const r = await toggleEnabled();
                return `Переключено клипов: ${r.changed}.`;
              })
            }
          />
        </div>
        <div className="act-settings">
          <Slider
            label="Длина для «Длина … с»"
            value={dur}
            min={0.2}
            max={10}
            step={0.1}
            unit="с"
            format={(v) => v.toFixed(1)}
            onChange={(v) => {
              setDur(v);
              storageSet("montageDur", String(v));
            }}
          />
          <div className="act-chips">
            <Chip label="Вплотную после «Длины»" value={pack} onChange={(v) => (setPack(v), storageSet("montagePack", v ? "1" : "0"))} />
            <Chip label="Обрезать до маркера" value={trim} onChange={(v) => (setTrim(v), storageSet("montageTrim", v ? "1" : "0"))} />
          </div>
        </div>
        {diag ? <div className="diag-box">Что Premiere отдаёт о тексте (пришлите скриншот, если шрифт не переносится):{"\n"}{diag}</div> : null}
      </div>
    </div>
  );
}

/** Вкладка «Звук»: плитки с иконками + настройки внизу. */
export function SoundView() {
  const [status, run] = useStatus();
  const [level, setLevel] = useState(() => Number(storageGet("soundLevel") ?? "-6") || -6);
  const [fi, setFi] = useState(() => Number(storageGet("soundFadeIn")) || 0.5);
  const [fo, setFo] = useState(() => Number(storageGet("soundFadeOut")) || 1);
  const [duck, setDuck] = useState(() => Number(storageGet("soundDuck")) || -12);
  const [duckFade, setDuckFade] = useState(() => Number(storageGet("soundDuckFade")) || 0.3);
  const save = (k: string, v: number) => storageSet(k, String(v));

  const gain = (delta: number) =>
    run("Меняю громкость…", async () => {
      const r = await changeLevel({ delta });
      return `${delta > 0 ? "+" : ""}${delta} дБ — клипов: ${r.clips}.${skippedNote(r.skipped)}${r.note ? ` ${r.note}` : ""}`;
    });

  return (
    <div className="page">
      <div className="scroll-inner act-page">
        <StatusLine status={status} />
        <div className="act-section">Громкость выделенных</div>
        <div className="act-grid">
          {[-6, -3, 3, 6].map((d) => (
            <Act key={d} icon={d > 0 ? "volup" : "voldown"} grad={d > 0 ? "green" : "orange"} label={`${d > 0 ? "+" : ""}${d} дБ`} hint="Изменить громкость выделенных аудиоклипов" onClick={() => void gain(d)} />
          ))}
          <Act
            icon="level"
            grad="blue"
            label={`Ровно ${level} дБ`}
            hint="Поставить точный уровень (ползунок ниже)"
            onClick={() =>
              void run("Ставлю уровень…", async () => {
                const r = await changeLevel({ absolute: level });
                return `Уровень ${level} дБ — клипов: ${r.clips}.${skippedNote(r.skipped)}${r.note ? ` ${r.note}` : ""}`;
              })
            }
          />
          <Act
            icon="fade"
            grad="purple"
            label="Фейды"
            hint="Плавное появление и затухание (ползунки ниже)"
            onClick={() =>
              void run("Ставлю фейды…", async () => {
                const r = await fades(fi, fo);
                return `Фейды — клипов: ${r.clips}.${skippedNote(r.skipped)}`;
              })
            }
          />
          <Act
            icon="duck"
            grad="pink"
            label="Музыка под голос"
            hint="Где говорят — музыка тише (голос и музыка — по правилам покраски)"
            onClick={() =>
              void run("Приглушаю музыку…", async () => {
                const r = await duckMusic(duck, duckFade);
                return `Готово: фраз ${r.voiceParts}, музыкальных клипов ${r.clips}.${skippedNote(r.skipped)} Отмена — Ctrl+Z (2 раза).`;
              })
            }
          />
        </div>
        <div className="act-settings">
          <Slider label="Точный уровень" value={level} min={-30} max={6} step={1} unit="дБ" onChange={(v) => (setLevel(v), save("soundLevel", v))} />
          <Slider label="Фейд: появление" value={fi} min={0} max={3} step={0.1} unit="с" format={(v) => (v ? v.toFixed(1) : "нет")} onChange={(v) => (setFi(v), save("soundFadeIn", v))} />
          <Slider label="Фейд: затухание" value={fo} min={0} max={5} step={0.1} unit="с" format={(v) => (v ? v.toFixed(1) : "нет")} onChange={(v) => (setFo(v), save("soundFadeOut", v))} />
          <Slider label="Музыка тише на" value={duck} min={-24} max={-3} step={1} unit="дБ" onChange={(v) => (setDuck(v), save("soundDuck", v))} />
          <Slider label="Плавность приглушения" value={duckFade} min={0.1} max={1.5} step={0.1} unit="с" format={(v) => v.toFixed(1)} onChange={(v) => (setDuckFade(v), save("soundDuckFade", v))} />
        </div>
        <div className="act-note">−14 LUFS: File → Export → Effects → Loudness Normalization (ITU BS.1770-3, −14 LUFS, True Peak −1).</div>
      </div>
    </div>
  );
}
