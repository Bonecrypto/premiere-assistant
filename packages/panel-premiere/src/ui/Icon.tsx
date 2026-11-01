/** Иконка интерфейса (PNG из design/icons — UXP показывает SVG-картинки на чёрном фоне). */
export type IconName =
  | "align" | "center" | "chat" | "chevron" | "compose" | "fill" | "fit" | "fliph" | "flipv"
  | "presets" | "reset" | "save" | "send" | "settings" | "star" | "tasks"
  | "bolt" | "palette" | "wave" | "marker";

export function Icon(props: { name: IconName; size?: number; className?: string }) {
  const size = props.size ?? 16;
  return (
    <img
      src={`icons/ui/${props.name}.png`}
      alt=""
      className={`icon ${props.className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}
