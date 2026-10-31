import { useEffect, useState } from "react";

/** Индикатор «печатает…». Анимация через JS: CSS-анимации в UXP поддерживаются не везде. */
export function Typing() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((v) => (v + 1) % 3), 400);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="typing-dots">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`typing-dot${i === n ? " is-on" : ""}`} />
      ))}
    </div>
  );
}
