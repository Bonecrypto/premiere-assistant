import { DEFAULT_HELPER_PORT } from "@pa/core";
import { useState } from "react";
import { Button } from "./Button.tsx";

export function Settings(props: { port: number; isUXP: boolean; onChangePort(p: number): void; onClose(): void }) {
  const [value, setValue] = useState(String(props.port));
  const n = Number(value);
  const valid = Number.isInteger(n) && n > 0 && n < 65536;

  return (
    <div className="settings">
      <div className="settings-row">
        <span className="label">Порт помощника</span>
        <input
          className="port-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <Button variant="primary" disabled={!valid || n === props.port} onClick={() => props.onChangePort(n)}>
          Применить
        </Button>
      </div>
      <div className="hint">
        Должен совпадать с HELPER_PORT в packages/helper/.env.
        {props.isUXP && n !== DEFAULT_HELPER_PORT
          ? " Для другого порта добавьте его в manifest.json (requiredPermissions.network) и пересоберите панель."
          : ""}
      </div>
      <div className="settings-row">
        <div className="spacer" />
        <Button variant="ghost" onClick={props.onClose}>
          Закрыть
        </Button>
      </div>
    </div>
  );
}
