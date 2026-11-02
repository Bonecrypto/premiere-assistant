import { TextField } from "./TextField.tsx";
import { useEffect, useState } from "react";
import { isAiConfigured, loadKeyFor, PROVIDER_INFO, type AiProvider, type AiSettings } from "../agent/settings.ts";
import { Button } from "./Button.tsx";
import { Segmented } from "./Segmented.tsx";

/**
 * Подключение ИИ без помощника: провайдер, ключ, модель. Ключ хранится в защищённом
 * хранилище Premiere (secureStorage) и никуда, кроме выбранного сервиса ИИ, не отправляется.
 */
export function AiKeyCard(props: { ai: AiSettings; onSave(next: AiSettings): Promise<void>; compact?: boolean }) {
  const [draft, setDraft] = useState<AiSettings>(props.ai);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(props.ai), [props.ai]);

  const info = PROVIDER_INFO[draft.provider];
  const changed = JSON.stringify(draft) !== JSON.stringify(props.ai);

  const switchProvider = async (provider: AiProvider) => {
    const apiKey = await loadKeyFor(provider);
    setDraft({ ...draft, provider, apiKey, model: provider === draft.provider ? draft.model : "" });
    setSaved(null);
  };

  const save = async () => {
    setBusy(true);
    try {
      await props.onSave(draft);
      setSaved(isAiConfigured(draft) ? "Сохранено — подключаюсь…" : "Сохранено, но ключ пустой");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-card">
      <div className="field-label">Сервис ИИ</div>
      <Segmented<AiProvider>
        className="segmented-small"
        items={[
          { id: "openrouter", label: "OpenRouter" },
          { id: "gemini", label: "Gemini" },
          { id: "ollama", label: "Ollama" },
        ]}
        value={draft.provider}
        onChange={(p) => void switchProvider(p)}
      />
      <div className="field-hint">
        {draft.provider === "openrouter" ? "Бесплатно: " : ""}
        {info.keyUrl}
      </div>

      {info.needsKey ? (
        <>
          <div className="field-label ai-gap">{info.keyLabel}</div>
          <TextField type="password" placeholder="Вставьте ключ (Ctrl+V)" value={draft.apiKey} onChange={(v: string) => {
                setDraft({ ...draft, apiKey: v });
                setSaved(null);
              }} />
        </>
      ) : (
        <>
          <div className="field-label ai-gap">Адрес Ollama</div>
          <TextField value={draft.ollamaUrl} onChange={(v: string) => setDraft({ ...draft, ollamaUrl: v })} />
        </>
      )}

      {!props.compact ? (
        <>
          <div className="field-label ai-gap">Модель (необязательно)</div>
          <TextField placeholder={
                draft.provider === "openrouter" ? "пусто — бесплатная, выберется сама" : draft.provider === "gemini" ? "gemini-2.5-flash" : "qwen3:8b"
              } value={draft.model} onChange={(v: string) => setDraft({ ...draft, model: v })} />
        </>
      ) : null}

      <div className="ai-actions">
        <span className="field-hint ai-status">{saved ?? (isAiConfigured(props.ai) ? "Подключено" : "")}</span>
        <div className="spacer" />
        <Button variant="primary" size="small" onClick={save} disabled={busy || !changed}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}
