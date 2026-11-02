import { useState, type ReactNode } from "react";
import { KEY_ADD_EDIT, KEY_ADD_EDIT_ALL, KEY_TIMELINE_FOCUS } from "@pa/core";
import { openKeysClient, lastKeysDiag } from "../automation/keysClient.ts";
import { nestSelected, unnestSelected } from "../automation/nest.ts";
import { copyStyle, pasteStyle } from "../automation/textStyle.ts";
import { closeGaps, placeOnMarkers, setDuration, toggleEnabled } from "../automation/montage.ts";
import { changeLevel, duckMusic, fades } from "../automation/sound.ts";
import { storageGet, storageSet } from "../env.ts";
import { Button } from "./Button.tsx";
import { Slider } from "./Slider.tsx";

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

function useStatus(): [Status, (busy: string, fn: () => Promise<string>) => Promise<void>] {
  const [status, setStatus] = useState<Status>(null);
  const run = async (busy: string, fn: () => Promise<string>) => {
    setStatus({ tone: "busy", text: busy });
    try {
      setStatus({ tone: "ok", text: await fn() });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };
  return [status, run];
}

function Card(props: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="hero-card tool-card">
      <div className="tool-title">{props.title}</div>
      <div className="tool-sub">{props.sub}</div>
      {props.children}
    </div>
  );
}

function Toggle(props: { label: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <div className="pv-row">
      <span className="pv-label">{props.label}</span>
      <div className="spacer" />
      <div className={`switch${props.value ? " is-on" : ""}`} onClick={() => props.onChange(!props.value)}>
        <div className="switch-knob" />
      </div>
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return <div className={status.tone === "busy" ? "result tool-status" : `result result-${status.tone} tool-status`}>{status.text}</div>;
}

const skippedNote = (s: string[]) => (s.length ? ` Пропущено: ${s.slice(0, 2).join("; ")}.` : "");

/** Вкладка «Монтаж». */
export function MontageView() {
  const [status, run] = useStatus();
  const [trim, setTrim] = useState(() => storageGet("montageTrim") !== "0");
  const [dur, setDur] = useState(() => Number(storageGet("montageDur")) || 2);
  const [pack, setPack] = useState(() => storageGet("montagePack") !== "0");

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
      return all
        ? "Разрезал все дорожки под плейхедом (Ctrl+Shift+K). Отмена — Ctrl+Z."
        : "Разрезал выбранные дорожки под плейхедом (Ctrl+K). Отмена — Ctrl+Z.";
    });

  return (
    <div className="page">
      <div className="scroll-inner">
        <div className="page-title">Монтаж</div>
        <div className="page-sub">Быстрые действия с выделенными клипами. Каждое — одна отмена Ctrl+Z.</div>
        <StatusLine status={status} />

        <Card title="Стиль текста" sub="Как у образца: шрифт, размер, заливка, обводка, выравнивание, позиция, масштаб. Текст каждого слоя остаётся своим.">
          <div className="confirm-actions">
            <Button variant="secondary" className="confirm-btn" onClick={() => void run("Копирую стиль…", () => copyStyle())}>
              Копировать стиль
            </Button>
            <Button variant="primary" className="confirm-btn" onClick={() => void run("Вставляю стиль…", () => pasteStyle())}>
              Вставить на выделенные
            </Button>
          </div>
        </Card>

        <Card title="Nest" sub="Собрать выделенные клипы во вложенную секвенцию (эффекты сохраняются) — или разобрать выделенный Nest обратно на клипы.">
          <div className="confirm-actions">
            <Button variant="primary" className="confirm-btn" onClick={() => void run("Собираю Nest…", () => nestSelected())}>
              Nest
            </Button>
            <Button variant="secondary" className="confirm-btn" onClick={() => void run("Разбираю…", () => unnestSelected())}>
              Разобрать Nest
            </Button>
          </div>
        </Card>

        <Card title="Разрез под плейхедом" sub="Через стандартные клавиши Premiere (Ctrl+K / Ctrl+Shift+K) — их нажимает программа-нажиматель.">
          <div className="confirm-actions">
            <Button variant="secondary" className="confirm-btn" onClick={() => void cut(false)}>
              Выбранные дорожки
            </Button>
            <Button variant="primary" className="confirm-btn" onClick={() => void cut(true)}>
              Все дорожки
            </Button>
          </div>
        </Card>

        <Card title="Убрать пустоты" sub="Выделенные клипы встают вплотную (на каждой дорожке отдельно). Если между ними есть невыделенный клип — дорожка пропускается.">
          <Button
            variant="primary"
            className="wide"
            onClick={() =>
              void run("Сдвигаю…", async () => {
                const r = await closeGaps();
                return `Сдвинуто клипов: ${r.changed}.${skippedNote(r.skipped)}`;
              })
            }
          >
            Убрать пустоты
          </Button>
        </Card>

        <Card title="Разложить по маркерам" sub="Клипы по порядку встают на маркеры секвенции — удобно под биты музыки (маркеры: клавиша M или «Авто → Маркеры»).">
          <Toggle
            label="Обрезать до следующего маркера"
            value={trim}
            onChange={(v) => {
              setTrim(v);
              storageSet("montageTrim", v ? "1" : "0");
            }}
          />
          <Button
            variant="primary"
            className="wide"
            onClick={() =>
              void run("Раскладываю…", async () => {
                const r = await placeOnMarkers(trim);
                return `Разложено клипов: ${r.changed}.${skippedNote(r.skipped)} Связанный звук может не сдвинуться вместе с видео — лучше для фото и графики.`;
              })
            }
          >
            Разложить по маркерам
          </Button>
        </Card>

        <Card title="Одинаковая длина" sub="Для фото, графики и нарезки: все выделенные клипы — одной длительности.">
          <Slider
            label="Длительность"
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
          <Toggle
            label="И сразу вплотную друг к другу"
            value={pack}
            onChange={(v) => {
              setPack(v);
              storageSet("montagePack", v ? "1" : "0");
            }}
          />
          <Button
            variant="primary"
            className="wide"
            onClick={() =>
              void run("Меняю длительность…", async () => {
                const r = await setDuration(dur, pack);
                return `Длительность ${dur.toFixed(1)} с — клипов: ${r.changed}.`;
              })
            }
          >
            Применить
          </Button>
        </Card>

        <Card title="Выключить / включить" sub="Как Shift+E: клипы остаются на таймлайне, но не видны и не слышны.">
          <Button
            variant="secondary"
            className="wide"
            onClick={() =>
              void run("…", async () => {
                const r = await toggleEnabled();
                return `Переключено клипов: ${r.changed}.`;
              })
            }
          >
            Выключить / включить выделенные
          </Button>
        </Card>
      </div>
    </div>
  );
}

/** Вкладка «Звук». */
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
      <div className="scroll-inner">
        <div className="page-title">Звук</div>
        <div className="page-sub">Громкость, фейды и приглушение музыки — через Volume → Level выделенных аудиоклипов.</div>
        <StatusLine status={status} />

        <Card title="Громкость выделенных" sub="Шаг или точный уровень. Клипы с ключами громкости не трогаются.">
          <div className="gain-row">
            {[-6, -3, 3, 6].map((d) => (
              <div key={d} className="gain-btn" onClick={() => void gain(d)}>
                {d > 0 ? `+${d}` : d} дБ
              </div>
            ))}
          </div>
          <Slider
            label="Уровень"
            value={level}
            min={-30}
            max={6}
            step={1}
            unit="дБ"
            onChange={(v) => {
              setLevel(v);
              save("soundLevel", v);
            }}
          />
          <Button
            variant="primary"
            className="wide"
            onClick={() =>
              void run("Ставлю уровень…", async () => {
                const r = await changeLevel({ absolute: level });
                return `Уровень ${level} дБ — клипов: ${r.clips}.${skippedNote(r.skipped)}${r.note ? ` ${r.note}` : ""}`;
              })
            }
          >
            Поставить {level} дБ
          </Button>
        </Card>

        <Card title="Фейды" sub="Плавное появление и затухание выделенных аудиоклипов (ключи громкости).">
          <Slider label="Появление" value={fi} min={0} max={3} step={0.1} unit="с" format={(v) => (v ? v.toFixed(1) : "нет")} onChange={(v) => (setFi(v), save("soundFadeIn", v))} />
          <Slider label="Затухание" value={fo} min={0} max={5} step={0.1} unit="с" format={(v) => (v ? v.toFixed(1) : "нет")} onChange={(v) => (setFo(v), save("soundFadeOut", v))} />
          <Button
            variant="primary"
            className="wide"
            onClick={() =>
              void run("Ставлю фейды…", async () => {
                const r = await fades(fi, fo);
                return `Фейды — клипов: ${r.clips}.${skippedNote(r.skipped)}`;
              })
            }
          >
            Сделать фейды
          </Button>
        </Card>

        <Card title="Музыка под голосом" sub="Где говорят — музыка тише. Голос и музыку панель находит по правилам покраски (лучше всего — по названиям дорожек).">
          <Slider label="Насколько тише" value={duck} min={-24} max={-3} step={1} unit="дБ" onChange={(v) => (setDuck(v), save("soundDuck", v))} />
          <Slider label="Плавность" value={duckFade} min={0.1} max={1.5} step={0.1} unit="с" format={(v) => v.toFixed(1)} onChange={(v) => (setDuckFade(v), save("soundDuckFade", v))} />
          <Button
            variant="primary"
            className="wide"
            onClick={() =>
              void run("Приглушаю музыку…", async () => {
                const r = await duckMusic(duck, duckFade);
                return `Готово: фраз ${r.voiceParts}, музыкальных клипов ${r.clips}.${skippedNote(r.skipped)} Отмена — Ctrl+Z (2 раза).`;
              })
            }
          >
            Приглушить музыку под голосом
          </Button>
        </Card>

        <Card title="Громкость −14 LUFS" sub="Измерение LUFS плагину недоступно (нужен ffmpeg). Пока проще так: File → Export → Effects → Loudness Normalization → ITU BS.1770-3, −14 LUFS, True Peak −1.">
          <div className="tool-soon">Измерение прямо в панели — в следующих версиях.</div>
        </Card>
      </div>
    </div>
  );
}
