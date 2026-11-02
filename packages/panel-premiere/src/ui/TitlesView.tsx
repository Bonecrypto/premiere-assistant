import { TextField } from "./TextField.tsx";
import { useEffect, useState } from "react";
import { isUXP } from "../env.ts";
import {
  DEFAULT_CATEGORY,
  importFiles,
  importFolder,
  insertMogrt,
  familiesOf,
  groupOf,
  loadFavorites,
  loadIndex,
  loadRecent,
  moveToSection,
  pushRecent,
  removeMogrt,
  rescan,
  saveFavorites,
  thumbErrors,
  thumbnail,
  type Mogrt,
} from "../mogrt/library.ts";
import { Button } from "./Button.tsx";
import { Segmented } from "./Segmented.tsx";
import { storageGet, storageSet } from "../env.ts";

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

const AUTO_ORDER = ["Появление", "Исчезновение", "Плашки", "Субтитры", "Заголовки и текст", "Стили и эффекты"];
const SIZE_KEY = "titlesSize";
const COLLAPSED_KEY = "titlesCollapsed";

function useWidth(): number {
  const get = () => (typeof window !== "undefined" ? window.innerWidth || 360 : 360);
  const [w, setW] = useState(get);
  useEffect(() => {
    const on = () => setW(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

function loadCollapsed(): string[] {
  try {
    const v = JSON.parse(storageGet(COLLAPSED_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Вкладка «Титры»: свои .mogrt внутри плагина — разделы (свои и автоматические), поиск, избранное, недавние, вставка. */
export function TitlesView() {
  const [list, setList] = useState<Mogrt[]>(loadIndex);
  const [favs, setFavs] = useState<string[]>(loadFavorites);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("Все");
  const [sel, setSel] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [status, setStatus] = useState<Status>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moving, setMoving] = useState(false);
  const [newSection, setNewSection] = useState("");
  const [size, setSizeState] = useState<"big" | "small">(() => (storageGet(SIZE_KEY) === "small" ? "small" : "big"));
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);
  const width = useWidth();
  const wide = width >= 600;

  useEffect(() => {
    if (!isUXP) return;
    void rescan().then(setList).catch(() => {});
  }, []);

  // Превью грузим по одному, чтобы не подвешивать панель.
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const m of list) {
        if (!alive) return;
        if (m.id in thumbs) continue;
        const uri = await thumbnail(m);
        if (!alive) return;
        setThumbs((t) => ({ ...t, [m.id]: uri }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [list]);

  // Разделы: свои папки + автоматические по названиям.
  const families = familiesOf(list);
  const groupById = new Map(list.map((m) => [m.id, groupOf(m, families)]));
  const counts = new Map<string, number>();
  for (const g of groupById.values()) counts.set(g, (counts.get(g) ?? 0) + 1);
  const userGroups = [...new Set(list.filter((m) => m.category !== DEFAULT_CATEGORY).map((m) => m.category))].sort((a, b) => a.localeCompare(b, "ru"));
  const autoGroups = [...counts.keys()].filter((g) => !userGroups.includes(g));
  const rank = (g: string) => {
    const i = AUTO_ORDER.indexOf(g);
    if (g === "Другое") return 1000;
    return i >= 0 ? (i < 2 ? i : 100 + i) : 50;
  };
  autoGroups.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "ru"));
  const groups = [...userGroups, ...autoGroups];

  const q = query.trim().toLowerCase();
  const matches = (m: Mogrt) => !q || m.name.toLowerCase().includes(q) || (groupById.get(m.id) ?? "").toLowerCase().includes(q);
  const inGroup = (m: Mogrt) =>
    group === "Все" ? true : group === "★" ? favs.includes(m.id) : group === "Недавние" ? recent.includes(m.id) : groupById.get(m.id) === group;
  let shown = list.filter((m) => inGroup(m) && matches(m));
  if (group === "Недавние") shown = recent.map((id) => shown.find((m) => m.id === id)).filter(Boolean) as Mogrt[];
  const chosen = list.find((m) => m.id === sel) ?? null;

  // Колонки — по ширине области карточек и размеру.
  const areaW = (wide ? width * 0.68 : width) - 28;
  const cols = Math.max(2, Math.min(7, Math.floor(areaW / (size === "big" ? 180 : 118))));
  const cardWidth = `${(100 - 2.5 * (cols - 1)) / cols}%`;

  const run = async (busy: string, fn: () => Promise<string | null>) => {
    setStatus({ tone: "busy", text: busy });
    try {
      const text = await fn();
      setStatus(text ? { tone: "ok", text } : null);
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };

  const addFolder = () =>
    run("Копирую шаблоны в плагин…", async () => {
      const r = await importFolder();
      if (!r) return null;
      setList(r.list);
      return `Добавлено: ${r.added}${r.skipped ? `, не удалось: ${r.skipped}` : ""}. Всего в плагине: ${r.list.length}.`;
    });

  const addFiles = () =>
    run("Копирую…", async () => {
      const r = await importFiles(userGroups.includes(group) ? group : DEFAULT_CATEGORY);
      if (!r) return null;
      setList(r.list);
      return `Добавлено: ${r.added}. Всего в плагине: ${r.list.length}.`;
    });

  const insert = (m: Mogrt) =>
    run("Вставляю…", async () => {
      const r = await insertMogrt(m);
      setRecent(pushRecent(m.id));
      return `«${m.name}» — на V${r.track + 1}, ${r.at.toFixed(2)} с. Отмена — Ctrl+Z.`;
    });

  const move = (m: Mogrt, section: string) =>
    run("Перемещаю…", async () => {
      const r = await moveToSection(m, section);
      setList(r.list);
      setSel(r.id);
      setFavs(loadFavorites());
      setRecent(loadRecent());
      setMoving(false);
      setNewSection("");
      return `«${m.name}» → раздел «${section}».`;
    });

  const toggleFav = (id: string) => {
    const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
    setFavs(next);
    saveFavorites(next);
  };

  const toggleCollapsed = (g: string) => {
    const next = collapsed.includes(g) ? collapsed.filter((x) => x !== g) : [...collapsed, g];
    setCollapsed(next);
    storageSet(COLLAPSED_KEY, JSON.stringify(next));
  };

  const grid = (items: Mogrt[]) => {
    const rows: Mogrt[][] = [];
    for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
    return rows.map((row, i) => (
      <div key={i} className="lib-row">
        {row.map((m) => (
          <div
            key={m.id}
            className={`lib-card title-card${size === "small" ? " is-small" : ""}${m.id === sel ? " is-active" : ""}`}
            style={{ width: cardWidth, maxWidth: cardWidth, flexBasis: cardWidth }}
            title={thumbs[m.id] === null ? `Нет превью: ${thumbErrors.get(m.id) ?? "неизвестно"}` : m.name}
            onClick={() => {
              setSel(m.id);
              setConfirmDelete(false);
              setMoving(false);
            }}
            onDoubleClick={() => void insert(m)}
          >
            <div className="title-thumb">
              {thumbs[m.id] ? (
                <img className="title-thumb-img" src={thumbs[m.id]!} alt="" />
              ) : (
                <div className="title-thumb-ph">
                  <span className="title-thumb-text">{m.id in thumbs ? m.name : "…"}</span>
                </div>
              )}
            </div>
            <div className="lib-card-foot">
              <div className="lib-card-text">
                <div className="lib-card-title">{m.name.replace(/^[.\s_-]+/, "")}</div>
                {size === "big" ? <div className="lib-card-sub">{groupById.get(m.id)}</div> : null}
              </div>
              <span
                className={`lib-star${favs.includes(m.id) ? " is-on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFav(m.id);
                }}
              >
                {favs.includes(m.id) ? "★" : "☆"}
              </span>
            </div>
          </div>
        ))}
        {Array.from({ length: cols - row.length }, (_, k) => (
          <div key={`e${k}`} className="lib-card lib-card-empty" style={{ width: cardWidth, maxWidth: cardWidth, flexBasis: cardWidth }} />
        ))}
      </div>
    ));
  };

  const special = [
    { id: "Все", label: "Все", n: list.length },
    { id: "★", label: "★ Избранное", n: favs.filter((id) => list.some((m) => m.id === id)).length },
    { id: "Недавние", label: "Недавние", n: recent.filter((id) => list.some((m) => m.id === id)).length },
  ];

  const nav = wide ? (
    <div className="pv-side titles-side">
      {special.map((g) => (
        <div key={g.id} className={`ts-item${group === g.id ? " is-active" : ""}`} onClick={() => setGroup(g.id)}>
          <span className="ts-label">{g.label}</span>
          <span className="ts-count">{g.n}</span>
        </div>
      ))}
      {userGroups.length ? <div className="pv-group">Мои разделы</div> : null}
      {userGroups.map((g) => (
        <div key={g} className={`ts-item${group === g ? " is-active" : ""}`} onClick={() => setGroup(g)}>
          <span className="ts-label">{g}</span>
          <span className="ts-count">{counts.get(g) ?? 0}</span>
        </div>
      ))}
      {autoGroups.length ? <div className="pv-group">Автоматически</div> : null}
      {autoGroups.map((g) => (
        <div key={g} className={`ts-item${group === g ? " is-active" : ""}`} onClick={() => setGroup(g)}>
          <span className="ts-label">{g}</span>
          <span className="ts-count">{counts.get(g) ?? 0}</span>
        </div>
      ))}
    </div>
  ) : null;

  const sectioned = group === "Все" && !q;

  return (
    <div className="pv">
      <div className="pv-body">
        {list.length ? nav : null}
        <div className="page titles-page">
          <div className="scroll-inner">
            <div className="titles-head">
              <div className="page-title">{group === "Все" || list.length === 0 ? "Титры" : group === "★" ? "Избранное" : group}</div>
              <div className="spacer" />
              {list.length ? (
                <Segmented<"big" | "small">
                  className="segmented-small titles-size"
                  items={[
                    { id: "big", label: "Крупно" },
                    { id: "small", label: "Мелко" },
                  ]}
                  value={size}
                  onChange={(v) => {
                    setSizeState(v);
                    storageSet(SIZE_KEY, v);
                  }}
                />
              ) : null}
            </div>

            {list.length === 0 ? (
              <>
                <div className="page-sub">Ваши шаблоны .mogrt — внутри плагина. Выберите и вставьте под плейхед.</div>
                <div className="hero-card titles-empty">
                  <div className="titles-empty-title">Добавьте свои шаблоны</div>
                  <div className="titles-empty-text">
                    Выберите папку с .mogrt — панель скопирует их к себе. Подпапки станут разделами, остальное панель разложит сама по
                    названиям. Исходная папка потом не нужна.
                  </div>
                  <Button variant="primary" className="wide hero-btn" onClick={addFolder} disabled={status?.tone === "busy"}>
                    Выбрать папку с .mogrt
                  </Button>
                </div>
              </>
            ) : (
              <>
                <TextField className="lib-search" placeholder={`Поиск среди ${list.length} шаблонов`} value={query} onChange={(v: string) => setQuery(v)} />
                {!wide ? (
                  <div className="lib-chips">
                    {[...special.map((g) => ({ id: g.id, label: g.label, n: g.n })), ...groups.map((g) => ({ id: g, label: g, n: counts.get(g) ?? 0 }))].map((g) => (
                      <div key={g.id} className={`lib-chip${group === g.id ? " is-active" : ""}`} onClick={() => setGroup(g.id)}>
                        {g.label} <span className="chip-count">{g.n}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {shown.length === 0 ? (
                  <div className="pv-hint-block">
                    {group === "★" ? "Отметьте звёздочкой частые шаблоны." : group === "Недавние" ? "Здесь появятся шаблоны, которые вы вставляли." : "Ничего не нашлось."}
                  </div>
                ) : null}

                {sectioned
                  ? groups.map((g) => {
                      const items = shown.filter((m) => groupById.get(m.id) === g);
                      if (!items.length) return null;
                      const closed = collapsed.includes(g);
                      return (
                        <div key={g} className="ts-section">
                          <div className="ts-section-head" onClick={() => toggleCollapsed(g)}>
                            <span className="ts-chev">{closed ? "›" : "⌄"}</span>
                            <span className="ts-section-title">{g}</span>
                            <span className="ts-count">{items.length}</span>
                            <div className="spacer" />
                            <span
                              className="link-small"
                              onClick={(e) => {
                                e.stopPropagation();
                                setGroup(g);
                              }}
                            >
                              Открыть ›
                            </span>
                          </div>
                          {closed ? null : grid(items)}
                        </div>
                      );
                    })
                  : grid(shown)}

                {chosen && moving ? (
                  <div className="hero-card ts-move">
                    <div className="ts-move-title">«{chosen.name.replace(/^[.\s_-]+/, "")}» — в раздел:</div>
                    <div className="lib-chips">
                      {groups
                        .filter((g) => g !== groupById.get(chosen.id))
                        .map((g) => (
                          <div key={g} className="lib-chip" onClick={() => void move(chosen, g)}>
                            {g}
                          </div>
                        ))}
                    </div>
                    <div className="pv-save">
                      <TextField className="pv-save-input" placeholder="Новый раздел" value={newSection} onChange={(v: string) => setNewSection(v)} />
                      <Button variant="primary" size="small" disabled={!newSection.trim()} onClick={() => void move(chosen, newSection.trim())}>
                        Создать
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="titles-tools">
                  <span className="link-small" onClick={addFolder}>
                    + Папка
                  </span>
                  <span className="link-small" onClick={addFiles}>
                    + Файлы
                  </span>
                  <div className="spacer" />
                  {chosen ? (
                    <>
                      <span className="link-small" onClick={() => setMoving(!moving)}>
                        В раздел…
                      </span>
                      {confirmDelete ? (
                        <span
                          className="link-small pv-delete"
                          onClick={() =>
                            void run("Удаляю…", async () => {
                              const next = await removeMogrt(chosen);
                              setList(next);
                              setSel(null);
                              setConfirmDelete(false);
                              return `«${chosen.name}» удалён из плагина.`;
                            })
                          }
                        >
                          Точно удалить?
                        </span>
                      ) : (
                        <span className="link-small pv-delete" onClick={() => setConfirmDelete(true)}>
                          Удалить
                        </span>
                      )}
                    </>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {list.length === 0 ? null : (
        <div className="pv-footer">
          <span className={`pv-footer-text${status ? ` status-${status.tone}` : ""}`}>
            {status ? status.text : chosen ? chosen.name.replace(/^[.\s_-]+/, "") : "Выберите шаблон (двойной клик — сразу вставить)"}
          </span>
          <Button variant="primary" className="pv-apply" onClick={() => chosen && void insert(chosen)} disabled={!chosen || status?.tone === "busy"}>
            Вставить
          </Button>
        </div>
      )}
    </div>
  );
}
