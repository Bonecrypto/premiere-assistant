import { TextField } from "./TextField.tsx";
import { useEffect, useState } from "react";
import { isUXP } from "../env.ts";
import {
  DEFAULT_CATEGORY,
  importFiles,
  importFolder,
  insertMogrt,
  loadFavorites,
  loadIndex,
  removeMogrt,
  rescan,
  saveFavorites,
  thumbErrors,
  thumbnail,
  type Mogrt,
} from "../mogrt/library.ts";
import { Button } from "./Button.tsx";

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

/** Колонки сетки по ширине панели: узкая — 2, средняя — 3, широкая — 4–5. */
function useColumns(): number {
  const calc = () => {
    const w = typeof window !== "undefined" ? window.innerWidth || 360 : 360;
    return w >= 1100 ? 5 : w >= 820 ? 4 : w >= 560 ? 3 : 2;
  };
  const [cols, setCols] = useState(calc);
  useEffect(() => {
    const on = () => setCols(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return cols;
}

/** Вкладка «Титры»: свои .mogrt внутри плагина — поиск, разделы, избранное, вставка под плейхед. */
export function TitlesView() {
  const [list, setList] = useState<Mogrt[]>(loadIndex);
  const [favs, setFavs] = useState<string[]>(loadFavorites);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("Все");
  const [sel, setSel] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [status, setStatus] = useState<Status>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // При открытии — сверить список с папкой плагина.
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

  const cats = [...new Set(list.map((m) => m.category))];
  const q = query.trim().toLowerCase();
  const shown = list.filter(
    (m) => (cat === "Все" || (cat === "★" ? favs.includes(m.id) : m.category === cat)) && (!q || m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)),
  );
  const chosen = list.find((m) => m.id === sel) ?? null;

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
      const r = await importFiles(cat !== "Все" && cat !== "★" ? cat : DEFAULT_CATEGORY);
      if (!r) return null;
      setList(r.list);
      return `Добавлено: ${r.added}. Всего в плагине: ${r.list.length}.`;
    });

  const insert = (m: Mogrt) =>
    run("Вставляю…", async () => {
      const r = await insertMogrt(m);
      return `«${m.name}» — на V${r.track + 1}, ${r.at.toFixed(2)} с. Отмена — Ctrl+Z.`;
    });

  const toggleFav = (id: string) => {
    const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
    setFavs(next);
    saveFavorites(next);
  };

  const cols = useColumns();
  const rows: Mogrt[][] = [];
  for (let i = 0; i < shown.length; i += cols) rows.push(shown.slice(i, i + cols));
  const cardWidth = `${(100 - 2.5 * (cols - 1)) / cols}%`;

  return (
    <div className="pv">
      <div className="page titles-page">
        <div className="scroll-inner">
          <div className="page-title">Титры</div>
          <div className="page-sub">Ваши шаблоны .mogrt — внутри плагина. Выберите и вставьте под плейхед.</div>

          {list.length === 0 ? (
            <div className="hero-card titles-empty">
              <div className="titles-empty-title">Добавьте свои шаблоны</div>
              <div className="titles-empty-text">
                Выберите папку с .mogrt — панель скопирует их к себе. Подпапки станут разделами: «Заголовки», «Плашки», «Субтитры»…
                Исходная папка потом не нужна.
              </div>
              <Button variant="primary" className="wide hero-btn" onClick={addFolder} disabled={status?.tone === "busy"}>
                Выбрать папку с .mogrt
              </Button>
            </div>
          ) : (
            <>
              <TextField className="lib-search" placeholder={`Поиск среди ${list.length} шаблонов`} value={query} onChange={(v: string) => setQuery(v)} />
              <div className="lib-chips">
                {["Все", "★", ...cats].map((c) => (
                  <div key={c} className={`lib-chip${cat === c ? " is-active" : ""}`} onClick={() => setCat(c)}>
                    {c === "★" ? "★ Избранное" : c}
                  </div>
                ))}
              </div>
              {shown.length === 0 ? <div className="pv-hint-block">{cat === "★" ? "Отметьте звёздочкой частые шаблоны." : "Ничего не нашлось."}</div> : null}
              {rows.map((row, i) => (
                <div key={i} className="lib-row">
                  {row.map((m) => (
                    <div
                      key={m.id}
                      className={`lib-card title-card${m.id === sel ? " is-active" : ""}`}
                      style={{ width: cardWidth, maxWidth: cardWidth, flexBasis: cardWidth }}
                      title={thumbs[m.id] === null ? `Нет превью: ${thumbErrors.get(m.id) ?? "неизвестно"}` : m.name}
                      onClick={() => {
                        setSel(m.id);
                        setConfirmDelete(false);
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
                          <div className="lib-card-title">{m.name}</div>
                          <div className="lib-card-sub">{m.category}</div>
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
              ))}
              <div className="titles-tools">
                <span className="link-small" onClick={addFolder}>
                  + Папка
                </span>
                <span className="link-small" onClick={addFiles}>
                  + Файлы
                </span>
                <div className="spacer" />
                {chosen ? (
                  confirmDelete ? (
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
                      Точно удалить «{chosen.name}»?
                    </span>
                  ) : (
                    <span className="link-small pv-delete" onClick={() => setConfirmDelete(true)}>
                      Удалить
                    </span>
                  )
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
      {list.length === 0 ? null : (
      <div className="pv-footer">
        <span className={`pv-footer-text${status ? ` status-${status.tone}` : ""}`}>
          {status ? status.text : chosen ? chosen.name : list.length ? "Выберите шаблон (двойной клик — сразу вставить)" : ""}
        </span>
        <Button variant="primary" className="pv-apply" onClick={() => chosen && void insert(chosen)} disabled={!chosen || status?.tone === "busy"}>
          Вставить
        </Button>
      </div>
      )}
    </div>
  );
}
