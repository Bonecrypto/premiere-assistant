import type { HelloAckMsg } from "@pa/core";
import { useEffect, useState } from "react";
import type { ConnectionStatus } from "../connection.ts";
import { isUXP } from "../env.ts";
import { getHostTool } from "../hostTools/index.ts";
import { Button, IconTile } from "./Button.tsx";
import { Logo } from "./Logo.tsx";

type Check = "ok" | "fail" | "pending" | "optional";

interface ProjectInfo {
  state: Check;
  text: string;
}

/** Проверяем проект прямо в панели (только чтение, помощник не нужен). */
async function checkProject(): Promise<ProjectInfo> {
  if (!isUXP) return { state: "optional", text: "Откройте панель внутри Premiere Pro" };
  const tool = getHostTool("premiere.get_context");
  if (!tool) return { state: "optional", text: "Проверка недоступна" };
  try {
    const r = (await tool.run({})) as { project: { name: string } | null; activeSequence?: { name: string } | null };
    if (!r.project) return { state: "optional", text: "Откройте проект — без него я отвечу только на общие вопросы" };
    const seq = r.activeSequence ? ` · ${r.activeSequence.name}` : "";
    return { state: "ok", text: `${r.project.name}${seq}` };
  } catch (err) {
    return { state: "optional", text: (err as Error).message };
  }
}

/**
 * Экран приветствия перед первым использованием: что умеет ассистент и чек-лист готовности.
 * Каждая проверка обновляется сама — пользователь видит, что именно осталось сделать.
 */
export function Onboarding(props: {
  connection: ConnectionStatus;
  helper: HelloAckMsg | null;
  onDone(): void;
}) {
  const [project, setProject] = useState<ProjectInfo>({ state: "pending", text: "Проверяю…" });

  useEffect(() => {
    let alive = true;
    const run = () => checkProject().then((p) => alive && setProject(p));
    run();
    const t = setInterval(run, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const helperCheck: Check =
    props.connection === "connected" ? "ok" : props.connection === "connecting" ? "pending" : "fail";
  const keyCheck: Check = !props.helper ? "pending" : props.helper.apiKeyConfigured ? "ok" : "fail";
  const ready = helperCheck === "ok" && keyCheck === "ok";

  return (
    <div className="onboarding">
      <div className="scroll-inner">
      <div className="onb-hero">
        <Logo size={64} className="onb-logo" />
        <div className="onb-title">Ассистент для Premiere</div>
        <div className="onb-subtitle">Ваш помощник по монтажу — прямо в панели</div>
      </div>

      <div className="onb-features">
        <Feature tone="blue" glyph="?" title="Спрашивайте" text="О монтаже, звуке, цвете — с учётом вашего проекта." />
        <Feature tone="indigo" glyph="⚡" title="Поручайте" text="«Проверь громкость», «раскрась клипы» — сделаю сам." />
        <Feature tone="purple" glyph="✓" title="Всё под контролем" text="Любое изменение сначала покажу и спрошу разрешения." />
      </div>

      <div className="section-head">
        <span className="section-title">Готовность</span>
      </div>
      <div className="group">
        <CheckRow
          state={helperCheck}
          title="Помощник запущен"
          text={helperCheck === "ok" ? "Связь есть" : "Запустите start-helper.cmd в папке проекта"}
        />
        <CheckRow
          state={keyCheck}
          title="API-ключ задан"
          text={
            keyCheck === "ok"
              ? "Всё в порядке"
              : keyCheck === "pending"
                ? "Станет известно после подключения"
                : `Впишите ${props.helper?.apiKeyVar ?? "ключ"} в packages/helper/.env и перезапустите помощника`
          }
        />
        <CheckRow state={project.state} title="Проект открыт" text={project.text} />
      </div>

      <div className="onb-actions">
        <Button variant="primary" size="large" disabled={!ready} onClick={props.onDone} className="wide">
          {ready ? "Начать" : "Ждём готовности…"}
        </Button>
        <Button variant="plain" onClick={props.onDone}>
          Пропустить
        </Button>
      </div>
    </div>
    </div>
  );
}

function Feature(props: { tone: "blue" | "indigo" | "purple"; glyph: string; title: string; text: string }) {
  return (
    <div className="feature">
      <IconTile glyph={props.glyph} tone={props.tone} />
      <div className="feature-text">
        <div className="feature-title">{props.title}</div>
        <div className="feature-desc">{props.text}</div>
      </div>
    </div>
  );
}

const CHECK_GLYPH: Record<Check, { glyph: string; tone: "green" | "orange" | "gray" }> = {
  ok: { glyph: "✓", tone: "green" },
  fail: { glyph: "!", tone: "orange" },
  pending: { glyph: "…", tone: "gray" },
  optional: { glyph: "–", tone: "gray" },
};

function CheckRow(props: { state: Check; title: string; text: string }) {
  const g = CHECK_GLYPH[props.state];
  return (
    <div className="row">
      <div className="row-icon">
        <IconTile glyph={g.glyph} tone={g.tone} />
      </div>
      <div className="row-main">
        <div className="row-label">{props.title}</div>
        <div className="row-sublabel">{props.text}</div>
      </div>
    </div>
  );
}
