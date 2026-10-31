/**
 * Логотип плагина: белая кость на фиолетовой плитке.
 * Именно PNG: UXP рисует SVG-картинки на чёрном фоне и без градиентов.
 */
export function Logo(props: { size: number; className?: string }) {
  return (
    <img
      src="icons/logo.png"
      alt=""
      className={`logo ${props.className ?? ""}`}
      style={{ width: props.size, height: props.size }}
    />
  );
}
