import { TextField } from "./TextField.tsx";
import { useState } from "react";
import { storageSet } from "../env.ts";
import { installedUpdate } from "../update/loader.ts";
import { downloadUpdate, reloadPanel, resetToBuiltin, type UpdateInfo } from "../update/updater.ts";
import { APP_VERSION, updateRepo } from "../update/version.ts";
import { Button } from "./Button.tsx";
import { Row, Section } from "./Section.tsx";

/** Раздел «Обновления»: версия, проверка GitHub, установка в один клик, откат. */
export function UpdatesSection(props: { update: UpdateInfo | null; onCheck(): Promise<string>; onChanged(): void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [repo, setRepo] = useState(updateRepo());
  const fromUpdate = Boolean((window as any).__paUpdateLoaded);
  const pending = installedUpdate();

  const install = async () => {
    if (!props.update) return;
    setBusy(true);
    setStatus(`Скачиваю v${props.update.version}…`);
    try {
      await downloadUpdate(props.update);
      setStatus("Готово — перезапускаю панель…");
      if (!reloadPanel()) setStatus("Готово. Закройте и снова откройте панель, чтобы запустить новую версию.");
    } catch (err) {
      setStatus((err as Error)?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true);
    setStatus("Проверяю…");
    try {
      setStatus(await props.onCheck());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Обновления"
      footer="Новые версии собираются на GitHub после каждой правки. Панель проверяет их при запуске; установка — одной кнопкой, без переустановки плагина."
    >
      <Row
        label="Версия"
        sublabel={fromUpdate ? "загружена обновлением" : "встроенная (из установки)"}
        value={`v${(window as any).__paRunningVersion ?? APP_VERSION}`}
      />
      {props.update ? (
        <div className="row update-row">
          <div className="row-main">
            <div className="row-label">Доступна v{props.update.version}</div>
            {props.update.notes ? <div className="row-sublabel">{props.update.notes.split("\n").slice(0, 3).join(" · ")}</div> : null}
          </div>
          <Button variant="primary" size="small" onClick={install} disabled={busy}>
            Обновить
          </Button>
        </div>
      ) : (
        <div className="row">
          <div className="row-main">
            <div className="row-label">{repo ? "У вас последняя версия" : "Репозиторий не указан"}</div>
          </div>
          <Button variant="secondary" size="small" onClick={check} disabled={busy || !repo}>
            Проверить
          </Button>
        </div>
      )}
      {!updateRepo() || repo !== updateRepo() ? (
        <div className="row">
          <div className="row-main">
            <div className="row-label">Репозиторий GitHub</div>
            <TextField placeholder="логин/premiere-assistant" value={repo} onChange={(v: string) => setRepo(v.trim())} />
          </div>
          <Button
            variant="primary"
            size="small"
            disabled={!/^[\w.-]+\/[\w.-]+$/.test(repo)}
            onClick={() => {
              storageSet("updateRepo", repo);
              props.onChanged();
              void check();
            }}
          >
            Сохранить
          </Button>
        </div>
      ) : null}
      {fromUpdate || pending ? (
        <Row
          label="Вернуться к встроенной версии"
          sublabel="Если с обновлением что-то не так"
          value={<span className="chevron">›</span>}
          onClick={() => {
            resetToBuiltin();
            setStatus("Готово — перезапускаю панель…");
            if (!reloadPanel()) setStatus("Закройте и снова откройте панель.");
          }}
        />
      ) : null}
      {status ? <div className="update-status">{status}</div> : null}
    </Section>
  );
}
