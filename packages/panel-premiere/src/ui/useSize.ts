import { useEffect, useRef, useState } from "react";

/** Ширина и высота элемента (offsetWidth/Height + опрос: в Premiere resize-события ненадёжны). */
export function useSize<T extends HTMLElement = HTMLDivElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const w = Math.round(el.offsetWidth || el.clientWidth || 0);
      const h = Math.round(el.offsetHeight || el.clientHeight || 0);
      setSize((s) => (Math.abs(s.w - w) >= 1 || Math.abs(s.h - h) >= 1 ? { w, h } : s));
    };
    measure();
    const t = setInterval(measure, 700);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", measure);
    };
  }, []);
  return [ref, size];
}

/**
 * Размер плиток «без прокрутки»: начинаем с оценки, после отрисовки меряем содержимое и уменьшаем
 * по 4 px, пока оно не поместится в область (min 48). При изменении размера панели — заново.
 */
export function useFitTiles(area: { w: number; h: number }, estimate: number, content: React.RefObject<HTMLElement>, deps: unknown[] = []): number {
  const [size, setSize] = useState(estimate);
  const key = `${area.w}x${area.h}|${deps.join(",")}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setSize(estimate);
  }
  useEffect(() => {
    const el = content.current;
    if (!el || !area.h) return;
    const h = el.offsetHeight || el.scrollHeight || 0;
    if (h > area.h && size > 48) setSize(size - 4);
  });
  return size;
}
