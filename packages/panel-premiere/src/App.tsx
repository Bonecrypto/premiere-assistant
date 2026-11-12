import { PaletteView } from "./ui/PaletteView.tsx";
import { ElementsView } from "./ui/ElementsView.tsx";
import { makeId, type ToolCallMsg } from "@pa/core";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { EmbeddedTransport } from "./agent/embedded.ts";
import { loadAiSettings, saveAiSettings, type AiSettings } from "./agent/settings.ts";
import { HelperConnection, getSavedPort, savePort, type Transport } from "./connection.ts";
import { isUXP, storageGet, storageSet } from "./env.ts";
import { isAutoLabelOn, startAutoLabel, stopAutoLabel } from "./automation/autoLabel.ts";
import { getHostTool } from "./hostTools/index.ts";
import { initialState, reducer } from "./state.ts";
import { ChatView, QuickBar } from "./ui/ChatView.tsx";
import { Composer } from "./ui/Composer.tsx";
import { health } from "./ui/Header.tsx";
import { StatusBar } from "./ui/StatusBar.tsx";
import { checkForUpdate, type UpdateInfo } from "./update/updater.ts";
import { Onboarding } from "./ui/Onboarding.tsx";
import { AutoView } from "./ui/AutoView.tsx";
import { GraphView } from "./ui/GraphView.tsx";
import { TitlesView } from "./ui/TitlesView.tsx";
import { ColorView, EffectsView, TextView } from "./ui/RecipeView.tsx";
import { Segmented } from "./ui/Segmented.tsx";
import { Rail, type RailItem } from "./ui/Rail.tsx";
import { useSize } from "./ui/useSize.ts";
import { Icon } from "./ui/Icon.tsx";
import { FavsView } from "./ui/FavsView.tsx";
import { SafeZonesView } from "./ui/SafeZonesView.tsx";
import { autoCreateIfEmpty } from "./automation/projectBins.ts";
import { autoNameTracks } from "./automation/trackTemplate.ts";
import { MontageView, SoundView } from "./ui/MontageView.tsx";
import { PresetsView } from "./ui/PresetsView.tsx";
import { SettingsView } from "./ui/SettingsView.tsx";
import { TasksView } from "./ui/TasksView.tsx";

/** Страница панели (раздел). Вкладки шапки — группы страниц (GROUPS). */
type Tab = "palette" | "chat" | "favs" | "safe" | "auto" | "presets" | "effects" | "elements" | "montage" | "graph" | "text" | "titles" | "color" | "sound" | "tasks" | "settings";
type Group = "chat" | "favs" | "motion" | "fx" | "graphics" | "edit" | "settings" | "palette";

/** 5 вкладок с подписями; внутри — переключатель разделов. Каждая функция — в одном месте. */
const GROUPS: Record<"favs" | "motion" | "fx" | "graphics" | "edit", { label: string; icon: string; tone: string; pages: Array<[Tab, string]> }> = {
  favs: { label: "Пресеты", icon: "star", tone: "cyan", pages: [["favs", "Пресеты"]] },
  motion: { label: "Движение", icon: "graph", tone: "blue", pages: [["presets", "Анимации"], ["graph", "Графики"], ["text", "Текст"]] },
  fx: { label: "Эффекты", icon: "sparkle", tone: "pink", pages: [["effects", "Эффекты"], ["color", "Цвет"]] },
  graphics: { label: "Графика", icon: "shapes", tone: "violet", pages: [["elements", "Элементы"], ["titles", "Титры"], ["safe", "Зоны"]] },
  edit: { label: "Монтаж", icon: "scissors", tone: "green", pages: [["montage", "Монтаж"], ["auto", "Авто"], ["sound", "Звук"], ["tasks", "Задачи"]] },
};

function groupOf(t: Tab): Group {
  for (const [g, def] of Object.entries(GROUPS)) if (def.pages.some(([p]) => p === t)) return g as Group;
  return t === "settings" || t === "palette" ? t : "chat";
}

const ONBOARDING_KEY = "onboardingDone";
const TAB_KEY = "activeTab";

function savedTab(): Tab {
  const t = storageGet(TAB_KEY);
  return (["favs", "safe", "auto", "presets", "effects", "elements", "montage", "graph", "text", "titles", "color", "sound", "tasks", "settings"] as string[]).includes(t ?? "") || t === "chat" ? ((t as Tab) ?? "favs") : "favs";
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [port, setPort] = useState(getSavedPort);
  const [tab, setTabState] = useState<Tab>(savedTab);
  const [appRef, appSize] = useSize();
  const [onboarding, setOnboarding] = useState(() => storageGet(ONBOARDING_KEY) !== "1");
  const [draft, setDraft] = useState<string | null>(null);
  const [sequence, setSequence] = useState<string | null>(null);
  const connRef = useRef<Transport | null>(null);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  const checkUpdate = useCallback(async (): Promise<string> => {
    try {
      const info = await checkForUpdate();
      setUpdate(info);
      return info ? `Доступна v${info.version}` : "У вас последняя версия.";
    } catch (err) {
      return `Не удалось проверить: ${(err as Error)?.message || err}`;
    }
  }, []);

  // Проверка обновлений при запуске (тихо, через пару секунд).
  useEffect(() => {
    const t = setTimeout(() => void checkUpdate(), 3000);
    return () => clearTimeout(t);
  }, [checkUpdate]);

  useEffect(() => {
    void loadAiSettings().then(setAi);
  }, []);

  // Автопокраска новых файлов (если включена во «Авто → Покраска таймлайна»).
  useEffect(() => {
    if (isUXP && isAutoLabelOn()) void startAutoLabel();
    return () => stopAutoLabel();
  }, []);

  const saveAi = async (next: AiSettings) => {
    const saved = await saveAiSettings(next);
    setAi(saved);
  };

  const setTab = (t: Tab) => {
    setTabState(t);
    storageSet(TAB_KEY, t === "palette" ? "chat" : t);
    const g = groupOf(t);
    if (g in GROUPS) storageSet(`page:${g}`, t);
  };
  /** Клик по вкладке шапки — последний открытый раздел этой вкладки. */
  const openGroup = (g: Group) => {
    if (g in GROUPS) {
      const def = GROUPS[g as keyof typeof GROUPS];
      const last = storageGet(`page:${g}`) as Tab | null;
      setTab(last && def.pages.some(([p]) => p === last) ? last : def.pages[0][0]);
    } else setTab(g as Tab);
  };

  // Ctrl+K (или Ctrl+Space) — палитра команд, когда панель в фокусе.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = String(e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === "k" || k === "л" || k === " ")) {
        e.preventDefault?.();
        setTabState((cur) => (cur === "palette" ? "chat" : "palette"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Выполнение host-инструмента по запросу помощника (статус в «Задачах» присылает сам помощник).
  const runHostTool = useCallback(async (msg: ToolCallMsg) => {
    const conn = connRef.current;
    const tool = getHostTool(msg.name);
    if (!tool) {
      conn?.send({ type: "tool_result", callId: msg.callId, ok: false, error: `В панели нет инструмента "${msg.name}"` });
      return;
    }
    try {
      const result = await tool.run(msg.input ?? {});
      conn?.send({ type: "tool_result", callId: msg.callId, ok: true, result });
    } catch (err) {
      conn?.send({ type: "tool_result", callId: msg.callId, ok: false, error: (err as Error)?.message || String(err) });
    }
  }, []);

  // «Мозг»: встроенный ИИ прямо в панели (по умолчанию) или отдельный помощник.
  useEffect(() => {
    if (!ai) return;
    const onMessage = (msg: Parameters<ConstructorParameters<typeof HelperConnection>[1]>[0]) => {
      dispatch({ type: "helper", msg });
      if (msg.type === "tool_call") void runHostTool(msg);
      // Запрос подтверждения важнее текущей вкладки — показываем чат, чтобы его не пропустить.
      if (msg.type === "confirm_request") setTab("chat");
    };
    const onStatus = (status: Transport["status"]) => dispatch({ type: "status", status });
    dispatch({ type: "transport_switch" });
    const conn: Transport =
      ai.mode === "embedded" ? new EmbeddedTransport(ai, onMessage, onStatus) : new HelperConnection(port, onMessage, onStatus);
    connRef.current = conn;
    conn.start();
    return () => conn.stop();
  }, [runHostTool, ai, port]);

  // Активная секвенция для строки статуса (только чтение, раз в 5 с).
  useEffect(() => {
    if (!isUXP) return;
    const tool = getHostTool("premiere.get_context");
    if (!tool) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = (await tool.run({})) as { activeSequence?: { name: string } | null };
        if (alive) setSequence(r.activeSequence?.name ?? null);
        void autoCreateIfEmpty().catch(() => undefined);
        void autoNameTracks().catch(() => undefined);
      } catch {
        if (alive) setSequence(null);
      }
    };
    void poll();
    const t = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const send = (text: string) => {
    const conn = connRef.current;
    if (!conn || state.connection !== "connected") {
      dispatch({
        type: "notice",
        text: ai?.mode === "helper" ? "Нет связи с помощником. Запустите start-helper.cmd" : "ИИ ещё подключается — подождите пару секунд.",
        tone: "error",
      });
      return;
    }
    dispatch({ type: "user", id: makeId("u_"), text });
    if (!conn.send({ type: "user_message", text })) {
      dispatch({ type: "notice", text: "Не удалось отправить сообщение.", tone: "error" });
    }
  };

  const answerConfirm = (requestId: string, approved: boolean) => {
    connRef.current?.send({ type: "confirm_response", requestId, approved });
    dispatch({ type: "confirm_answered", requestId, approved });
  };

  const newChat = () => {
    if (state.busy) return;
    connRef.current?.send({ type: "reset" });
    dispatch({ type: "reset" });
  };

  const changePort = (p: number) => {
    savePort(p);
    setPort(p);
  };

  const finishOnboarding = () => {
    storageSet(ONBOARDING_KEY, "1");
    setOnboarding(false);
    setTab("chat");
  };

  const hs = health(state.connection, state.helper);
  const activeTasks = state.tasks.filter((t) => t.status === "running" || t.status === "waiting_confirm").length;

  if (onboarding) {
    return (
      <div className="app">
        <Onboarding connection={state.connection} helper={state.helper} onDone={finishOnboarding} ai={ai} onSaveAi={saveAi} />
      </div>
    );
  }

  return (
    <div className="app app-shell" ref={appRef}>
      <Rail<Group>
        wide={appSize.w >= 560}
        main={(Object.keys(GROUPS) as Array<keyof typeof GROUPS>).map((g) => ({
          id: g as Group,
          label: GROUPS[g].label,
          icon: GROUPS[g].icon,
          tone: GROUPS[g].tone,
          badge: g === "edit" ? activeTasks : undefined,
        }))}
        more={[
          { id: "chat", label: "Чат с ИИ", icon: "chat", tone: "orange" },
          { id: "settings", label: "Настройки", icon: "settings", tone: "gray" },
        ] as RailItem<Group>[]}
        active={groupOf(tab)}
        onSelect={openGroup}
        searchActive={tab === "palette"}
        onSearch={() => setTab(tab === "palette" ? "favs" : "palette")}
      />
      <div className="app-main">
      <div className="page-head">
        <span className="page-head-title">
          {tab === "palette" ? "Поиск" : tab === "settings" ? "Настройки" : tab === "chat" ? "Чат с ИИ" : GROUPS[groupOf(tab) as keyof typeof GROUPS]?.label ?? ""}
        </span>
        <div className="spacer" />
        {tab === "chat" ? (
          <div className={`icon-btn${state.busy || state.items.length === 0 ? " is-disabled" : ""}`} title="Новый чат" onClick={() => !(state.busy || state.items.length === 0) && newChat()}>
            <Icon name="compose" size={15} />
          </div>
        ) : null}
      </div>

      {tab === "chat" ? (
        <>
          <ChatView
            items={state.items}
            helper={state.helper}
            health={hs}
            busy={state.busy}
            onConfirm={answerConfirm}
            onSuggestion={setDraft}
            onOpenSettings={() => setTab("settings")}
            embedded={ai?.mode !== "helper"}
          />
          {state.items.length ? <QuickBar onPick={setDraft} /> : null}
          <Composer
            disabled={state.connection !== "connected"}
            busy={state.busy}
            draft={draft}
            onDraftConsumed={() => setDraft(null)}
            onSend={send}
            onStop={() => connRef.current?.send({ type: "cancel" })}
          />
        </>
      ) : null}
      {groupOf(tab) in GROUPS && GROUPS[groupOf(tab) as keyof typeof GROUPS].pages.length > 1 ? (
        <div className="subtabs">
          <Segmented<Tab>
            className="segmented-small"
            items={GROUPS[groupOf(tab) as keyof typeof GROUPS].pages
              .filter(([p]) => p !== "tasks" || state.tasks.length > 0)
              .map(([id, label]) => ({ id, label }))}
            value={tab}
            onChange={setTab}
          />
        </div>
      ) : null}
      {tab === "auto" ? <AutoView /> : null}
      {tab === "text" ? <TextView /> : null}
      {tab === "safe" ? <SafeZonesView /> : null}
      {tab === "favs" ? <FavsView onOpenTab={(t) => setTab(t as Tab)} /> : null}
      {tab === "presets" ? <PresetsView /> : null}
      {tab === "graph" ? <GraphView /> : null}
      {tab === "titles" ? <TitlesView /> : null}
      {tab === "effects" ? <EffectsView /> : null}
      {tab === "elements" ? <ElementsView /> : null}
      {tab === "palette" ? <PaletteView onOpenTab={(t) => setTab(t as Tab)} onClose={() => setTab("chat")} /> : null}
      {tab === "color" ? <ColorView /> : null}
      {tab === "montage" ? <MontageView /> : null}
      {tab === "sound" ? <SoundView /> : null}
      {tab === "tasks" ? <TasksView tasks={state.tasks} onClear={() => dispatch({ type: "clear_tasks" })} /> : null}
      {tab === "settings" ? (
        <SettingsView
          connection={state.connection}
          helper={state.helper}
          port={port}
          isUXP={isUXP}
          onChangePort={changePort}
          onReconnect={() => connRef.current?.reconnectNow()}
          onShowOnboarding={() => setOnboarding(true)}
          ai={ai}
          onSaveAi={saveAi}
          update={update}
          onCheckUpdate={checkUpdate}
        />
      ) : null}
      <StatusBar
        state={hs}
        helper={state.helper}
        sequence={sequence}
        onClick={() => setTab("settings")}
        update={update}
        onUpdateClick={() => setTab("settings")}
      />
      </div>
    </div>
  );
}
