import { useMemo, useState } from "react";
import { buildCommands, rememberCommand, searchCommands, type Command } from "../commands/registry.ts";
import { TextField } from "./TextField.tsx";

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

/**
 * Палитра команд: набрали «блюр» → Enter. Понимает неправильную раскладку («,k.h»), ищет по названию,
 * разделу и ключевым словам; пустой запрос — недавние. Стрелки — выбор, Esc — закрыть.
 */
export function PaletteView(props: { onOpenTab(tab: string): void; onClose(): void }) {
  const cmds = useMemo(() => buildCommands(), []);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<Status>(null);
  const results = searchCommands(cmds, q, 9);
  const sel = Math.min(active, Math.max(0, results.length - 1));

  const runCmd = async (c: Command | undefined) => {
    if (!c) return;
    rememberCommand(c.id);
    if (c.tab) {
      props.onOpenTab(c.tab);
      return;
    }
    if (!c.run) return;
    setStatus({ tone: "busy", text: `${c.title}…` });
    try {
      setStatus({ tone: "ok", text: await c.run((text) => setStatus({ tone: "busy", text })) });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };

  return (
    <div className="page">
      <div className="scroll-inner palette">
        <TextField
          value={q}
          autoFocus
          placeholder="Что сделать? «блюр», «фон», «паузы», «чб»…"
          onChange={(v) => {
            setQ(v);
            setActive(0);
          }}
          onEnter={() => void runCmd(results[sel])}
          onKey={(k) => {
            if (k === "ArrowDown") setActive(Math.min(results.length - 1, sel + 1));
            else if (k === "ArrowUp") setActive(Math.max(0, sel - 1));
            else if (k === "Escape") props.onClose();
          }}
        />
        <div className="palette-hint">{q.trim() ? `Найдено: ${results.length}` : "Недавние · Enter — выполнить, ↑↓ — выбор, Esc — закрыть"}</div>
        <div className="palette-list">
          {results.map((c, i) => (
            <div key={c.id} className={`palette-row${i === sel ? " is-active" : ""}`} onClick={() => void runCmd(c)} onMouseEnter={() => setActive(i)}>
              <span className="palette-title">{c.title}</span>
              <span className="palette-group">{c.tab ? "открыть" : c.group}</span>
            </div>
          ))}
          {!results.length ? <div className="palette-empty">Ничего не нашлось — попробуйте другое слово или спросите в чате.</div> : null}
        </div>
        {status ? <div className={status.tone === "busy" ? "result" : `result result-${status.tone}`}>{status.text}</div> : null}
      </div>
    </div>
  );
}
