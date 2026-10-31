import type { ReactNode } from "react";

/** Сгруппированный список в стиле Apple (inset grouped): заголовок, карточка, подпись. */
export function Section(props: { title?: string; footer?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section">
      {props.title ? (
        <div className="section-head">
          <span className="section-title">{props.title}</span>
          <div className="spacer" />
          {props.aside}
        </div>
      ) : null}
      <div className="group">{props.children}</div>
      {props.footer ? <div className="section-footer">{props.footer}</div> : null}
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
