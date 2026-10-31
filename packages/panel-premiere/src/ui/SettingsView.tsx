import { DEFAULT_HELPER_PORT, type HelloAckMsg } from "@pa/core";
import { useState } from "react";
import type { ConnectionStatus } from "../connection.ts";
import { Button, IconTile } from "./Button.tsx";
import { Row, Section } from "./Section.tsx";

const PANEL_VERSION = "0.1.0";

export function SettingsView(props: {
  connection: ConnectionStatus;
  helper: HelloAckMsg | null;
  port: number;
  isUXP: boolean;
  onChangePort(p: number): void;
  onReconnect(): void;
  onShowOnboarding(): void;
}) {
  const [value, setValue] = useState(String(props.port));
  const n = Number(value);
  const valid = Number.isInteger(n) && n > 0 && n < 65536;
  const connected = props.connection === "connected";

  return (
    <div className="page">
      <Section
        title="Помощник"
        footer={
          connected
            ? `Помощник — программа на вашем компьютере, которая общается с ИИ (${props.helper?.provider ?? "модель"}). Ключ API хранится только в ней. Сменить модель — AI_PROVIDER в packages/helper/.env.`
            : "Запустите start-helper.cmd в папке проекта (или npm start) — панель подключится сама."
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
        <Row
          icon={<IconTile glyph="AI" tone="purple" />}
          label="Модель"
          value={props.helper ? `${props.helper.provider ?? ""} · ${props.helper.model}` : "—"}
        />
      </Section>

      <Section
        title="Порт"
        footer={
          <>
            Должен совпадать с HELPER_PORT в packages/helper/.env.
            {props.isUXP && n !== DEFAULT_HELPER_PORT
              ? " Для другого порта добавьте его в manifest.json (requiredPermissions.network) и пересоберите панель."
              : ""}
          </>
        }
      >
        <div className="row">
          <div className="row-main">
            <div className="row-label">Порт помощника</div>
          </div>
          <input
            className="text-input port-input"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
          />
          <Button variant="primary" size="small" disabled={!valid || n === props.port} onClick={() => props.onChangePort(n)}>
            Применить
          </Button>
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
  );
}
