/**
 * Логотип плагина: белая кость на фиолетовой плитке.
 * Плитка рисуется CSS-градиентом: UXP не отображает градиенты внутри SVG.
 */
export function Logo(props: { size: number; className?: string }) {
  const { size } = props;
  return (
    <div
      className={`logo-tile ${props.className ?? ""}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}
    >
      <img src="icons/bone-white.svg" alt="" style={{ width: size * 0.66, height: size * 0.66 }} />
    </div>
  );
}
