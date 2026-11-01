import { useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

/**
 * Раздел: заголовок, карточка, подпись. Если задан collapsible — заголовок сворачивает раздел
 * (как группы в панелях монтажных программ).
 */
export function Section(props: {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  plain?: boolean;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  const isOpen = !props.collapsible || open;
  return (
    <div className="section">
      {props.title ? (
        <div
          className={`section-head${props.collapsible ? " is-collapsible" : ""}`}
          onClick={props.collapsible ? () => setOpen((v) => !v) : undefined}
        >
          {props.collapsible ? <Icon name="chevron" size={11} className={`section-chevron${open ? " is-open" : ""}`} /> : null}
          <span className="section-title">{props.title}</span>
          <div className="spacer" />
          {props.aside}
        </div>
      ) : null}
      {isOpen ? (
        <>
          {props.plain ? props.children : <div className="group">{props.children}</div>}
          {props.footer ? <div className="section-footer">{props.footer}</div> : null}
        </>
      ) : null}
    </div>
  );
}

/** Строка группы: слева подпись (и иконка), справа значение/контрол. */
export function Row(props: {
  icon?: ReactNode;
  label: ReactNode;
  sublabel?: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className={`row${props.onClick ? " row-clickable" : ""}`} onClick={props.onClick}>
      {props.icon ? <div className="row-icon">{props.icon}</div> : null}
      <div className="row-main">
        <div className="row-label">{props.label}</div>
        {props.sublabel ? <div className="row-sublabel">{props.sublabel}</div> : null}
      </div>
      {props.value !== undefined ? <div className="row-value">{props.value}</div> : null}
    </div>
  );
}
