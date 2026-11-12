import { useState } from "react";
import { insertSafeZone, removeSafeZones, SAFE_ZONES, toggleSafeZones, type SafeZone } from "../graphics/safeZones.ts";

type Status = { tone: "ok" | "error" | "busy"; text: string } | null;

/** Мини-превью зоны: рамка кадра, красное — опасно, зелёная рамка — безопасно (div, без картинок). */
function ZoneThumb({ z, h }: { z: SafeZone; h: number }) {
  const w = Math.round((h * z.w) / z.h);
  const k = h / z.h;
  return (
    <div className="sz-frame" style={{ width: w, height: h, backgroundColor: z.safe.length ? "rgba(255,59,48,0.45)" : "#1c1c22" }}>
      {z.safe.map((r, i) => (
        <div key={i} className="sz-safe" style={{ left: r[0] * k, top: r[1] * k, width: (r[2] - r[0]) * k, height: (r[3] - r[1]) * k }} />
      ))}
      {(z.outlines ?? []).map((r, i) => (
        <div key={`o${i}`} className="sz-outline" style={{ left: r[0] * k, top: r[1] * k, width: (r[2] - r[0]) * k, height: (r[3] - r[1]) * k }} />
      ))}
      {z.grid
        ? [1 / 3, 2 / 3].map((f) => [
            <div key={`v${f}`} className="sz-line" style={{ left: w * f, top: 0, width: 1, height: h }} />,
            <div key={`h${f}`} className="sz-line" style={{ left: 0, top: h * f, width: w, height: 1 }} />,
          ])
        : null}
    </div>
  );
}

/** «Графика → Безопасные зоны»: оверлеи Reels / TikTok / Shorts / 16:9 — клик кладёт поверх всей секвенции. */
export function SafeZonesView() {
  const [status, setStatus] = useState<Status>(null);
  const run = async (title: string, fn: () => Promise<string>) => {
    setStatus({ tone: "busy", text: `${title}…` });
    try {
      setStatus({ tone: "ok", text: await fn() });
    } catch (err) {
      setStatus({ tone: "error", text: (err as Error)?.message || String(err) });
    }
  };
  return (
    <div className="page">
      <div className="scroll-inner">
        <div className="sz-grid">
          {SAFE_ZONES.map((z) => (
            <div key={z.id} className="sz-tile" title={z.note} onClick={() => void run(z.name, () => insertSafeZone(z.id))}>
              <div className="sz-box">
                <ZoneThumb z={z} h={z.h > z.w ? 96 : 54} />
              </div>
              <div className="recipe-name">
                {z.name}
                {z.approx ? " ≈" : ""}
              </div>
            </div>
          ))}
        </div>
        <div className="sz-actions">
          <span className="lib-chip" onClick={() => void run("Прячу", () => toggleSafeZones(false))}>
            Спрятать
          </span>
          <span className="lib-chip" onClick={() => void run("Показываю", () => toggleSafeZones(true))}>
            Показать
          </span>
          <span className="lib-chip" onClick={() => void run("Убираю", () => removeSafeZones())}>
            Убрать все
          </span>
        </div>
        <div className={`fav-status${status ? ` status-${status.tone}` : ""}`}>
          {status
            ? status.text
            : "Клик — оверлей поверх всей секвенции. Красное закроет интерфейс соцсети. Перед экспортом — «Спрятать» (выключенные клипы не экспортируются). ≈ — примерные зоны."}
        </div>
      </div>
    </div>
  );
}
