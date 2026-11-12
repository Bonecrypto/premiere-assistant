import { storageGet, storageSet } from "./env.ts";

/** Цвет акцента (как «colorways»): меняет кнопки, выделение, ваши сообщения. Фиолетовый — фирменный. */
export interface Accent {
  id: string;
  label: string;
  /** Основной цвет (и запасной, если градиент не отрисуется). */
  color: string;
  gradient: string;
  /** Полупрозрачная подложка для меток и выделений. */
  soft: string;
  /** Светлый оттенок для ссылок и текста на тёмном. */
  text: string;
}

export const ACCENTS: Accent[] = [
  {
    id: "sky",
    label: "Небесный",
    color: "#1e90ff",
    gradient: "linear-gradient(135deg, #38bdf8 0%, #1e90ff 55%, #2563eb 100%)",
    soft: "rgba(56, 189, 248, 0.18)",
    text: "#7dd3fc",
  },
  {
    id: "violet",
    label: "Фиолетовый",
    color: "#7a1cf0",
    gradient: "linear-gradient(135deg, #9f18ec 0%, #6a12dc 55%, #4b0cb4 100%)",
    soft: "rgba(159, 24, 236, 0.22)",
    text: "#c79bff",
  },
  {
    id: "blue",
    label: "Синий",
    color: "#0a84ff",
    gradient: "linear-gradient(135deg, #3a9bff 0%, #0a84ff 55%, #0050d0 100%)",
    soft: "rgba(10, 132, 255, 0.22)",
    text: "#8cc4ff",
  },
  {
    id: "pink",
    label: "Розовый",
    color: "#e01e64",
    gradient: "linear-gradient(135deg, #ff5a92 0%, #e01e64 55%, #a8104a 100%)",
    soft: "rgba(255, 45, 120, 0.22)",
    text: "#ff9cc0",
  },
  {
    id: "green",
    label: "Зелёный",
    color: "#24b24a",
    gradient: "linear-gradient(135deg, #4ee07a 0%, #24b24a 55%, #128a36 100%)",
    soft: "rgba(48, 209, 88, 0.2)",
    text: "#8ff0ab",
  },
  {
    id: "orange",
    label: "Оранжевый",
    color: "#f07800",
    gradient: "linear-gradient(135deg, #ffb340 0%, #ff8a00 55%, #d9480f 100%)",
    soft: "rgba(255, 159, 10, 0.2)",
    text: "#ffc980",
  },
];

const KEY = "accent";

export function savedAccent(): Accent {
  const id = storageGet(KEY);
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

export function applyAccent(accent: Accent, persist = false): void {
  const s = document.documentElement.style;
  s.setProperty("--accent", accent.color);
  s.setProperty("--accent-gradient", accent.gradient);
  s.setProperty("--accent-soft", accent.soft);
  s.setProperty("--accent-text", accent.text);
  if (persist) storageSet(KEY, accent.id);
}
