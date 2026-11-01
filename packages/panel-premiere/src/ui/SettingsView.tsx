import type { HelloAckMsg } from "@pa/core";
import type { AiMode, AiSettings } from "../agent/settings.ts";
import { AiKeyCard } from "./AiKeyCard.tsx";
import { UpdatesSection } from "./UpdatesSection.tsx";
import type { UpdateInfo } from "../update/updater.ts";
import { Segmented } from "./Segmented.tsx";
import { useState } from "react";
import { ACCENTS, applyAccent, savedAccent } from "../theme.ts";
import type { ConnectionStatus } from "../connection.ts";
import { Button, IconTile } from "./Button.tsx";
import { Row, Section } from "./Section.tsx";

const PANEL_VERSION = __APP_VERSION__;

export function SettingsView(props: {
  connection: ConnectionStatus;
  helper: HelloAckMsg | null;
  port: number;
  isUXP: boolean;
  onChangePort(p: number): void;
  onReconnect(): void;
  onShowOnboarding(): void;
  ai: AiSettings | null;
  onSaveAi(next: AiSettings): Promise<void>;
  update: UpdateInfo | null;
  onCheckUpdate(): Promise<string>;
}) {
  const [value, setValue] = useState(String(props.port));
  const n = Number(value);
  const valid = Number.isInteger(n) && n > 0 && n < 65536;
  const connected = props.connection === "connected";
  const [accent, setAccent] = useState(savedAccent().id);
  const accentLabel = ACCENTS.find((a) => a.id === accent)?.label ?? "";

  return (
    <div className="page">
      <div className="scroll-inner">
      <Section
        title="ИИ"
        footer={
          props.ai?.mode === "helper"
            ? "Через помощника: отдельная программа на компьютере (start-helper.cmd), ключ — в её .env."
            : "Встроенный режим: ИИ работает прямо из панели, ничего запускать не нужно. Ключ хранится в защищённом хранилище Premiere."
        }
      >
        <div className="row">
          <div className="row-main">
            <div className="row-label">Режим</div>
          </div>
          {props.ai ? (
            <Segmented<AiMode>
              className="segmented-small mode-switch"
              items={[
                { id: "embedded", label: "Встроенный" },
                { id: "helper", label: "Помощник" },
              ]}
              value={props.ai.mode}
              onChange={(mode) => void props.onSaveAi({ ...props.ai!, mode })}
            />
          ) : null}
        </div>
        {props.ai && props.ai.mode === "embedded" ? <AiKeyCard ai={props.ai} onSave={props.onSaveAi} /> : null}
        {props.ai ? (
          <Row icon={<IconTile glyph="AI" tone="purple" />} label="Модель" value={props.helper ? props.helper.model : "—"} />
        ) : null}
      </Section>

{props.ai?.mode === "helper" ? (
        <>
      <Section
        title="Помощник"
        footer={
          connected
            ? `Помощник — программа на вашем компьютере, которая общается с ИИ (${props.helper?.provider ?? "модель"}). Ключ API хранится только в ней. Сменить модель — AI_PROVIDER в packages/helper/.env.`
            : "Запустите start-helper.cmd в папке проекта — панель подключится сама. Автозапуск с Windows: один раз запустите autostart-on.cmd."
        }
      >
        <Row
          icon={<IconTile glyph="⇄" tone={connected ? "green" : "orange"} />}
          label="Подключение"
          value={
            connected ? (
              <span className="text-ok">Подключено</span>
            ) : (
              <Button variant="plain" size="small" onClick={props.onReconnect}>
                {props.connection === "connecting" ? "Подключение…" : "Переподключить"}
              </Button>
            )
          }
        />
        <Row
          icon={<IconTile glyph="⚿" tone={props.helper?.apiKeyConfigured ? "green" : "orange"} />}
          label="API-ключ"
          sublabel={props.helper && !props.helper.apiKeyConfigured ? `Впишите ${props.helper.apiKeyVar ?? "ключ"} в packages/helper/.env` : undefined}
          value={props.helper ? (props.helper.apiKeyConfigured ? "Задан" : "Не задан") : "—"}
        />
      </Section>

      <Section
        title="Порт"
        footer={
          <>
            Должен совпадать с HELPER_PORT в packages/helper/.env.

          </>
        }
      >
        <div className="row">
          <div className="row-main">
            <div className="row-label">Порт помощника</div>
          </div>
          {/* Ширина задаётся обёрткой: UXP растягивает поле ввода и игнорирует его width. */}
          <div className="port-box">
            <input
              className="text-input port-input"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
          <Button variant="primary" size="small" disabled={!valid || n === props.port} onClick={() => props.onChangePort(n)}>
            Применить
          </Button>
        </div>
      </Section>

        </>
      ) : null}

      <UpdatesSection update={props.update} onCheck={props.onCheckUpdate} onChanged={() => void props.onCheckUpdate()} />

      <Section title="Оформление">
        <div className="row">
          <div className="row-main">
            <div className="row-label">Цвет акцента</div>
            <div className="row-sublabel">{accentLabel}{accent === "violet" ? " · фирменный" : ""}</div>
          </div>
          <div className="swatches">
            {ACCENTS.map((a) => (
              <div
                key={a.id}
                title={a.label}
                className={`swatch${a.id === accent ? " is-active" : ""}`}
                onClick={() => {
                  applyAccent(a, true);
                  setAccent(a.id);
                }}
              >
                <div className="swatch-fill" style={{ backgroundColor: a.color, backgroundImage: a.gradient }} />
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Справка">
        <Row
          icon={<IconTile glyph="?" tone="blue" />}
          label="Показать приветствие"
          sublabel="Проверка готовности и краткое знакомство"
          value={<span className="chevron">›</span>}
          onClick={props.onShowOnboarding}
        />
      </Section>

      <Section title="О плагине">
        <Row label="Панель" value={`v${PANEL_VERSION}`} />
        <Row label="Помощник" value={props.helper ? `v${props.helper.helperVersion}` : "—"} />
        <Row label="Инструментов" value={props.helper ? String(props.helper.tools.length) : "—"} />
      </Section>
    </div>
    </div>
  );
}
