/** Логотип плагина: белая кость на фиолетовой плитке (файл public/icons/logo.svg). */
export function Logo(props: { size: number; className?: string }) {
  return (
    <img
      src="icons/logo.svg"
      alt=""
      className={`logo ${props.className ?? ""}`}
      style={{ width: props.size, height: props.size }}
    />
  );
}
