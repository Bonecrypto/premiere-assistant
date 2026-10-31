import { Fragment, type ReactNode } from "react";

/** Минимальная разметка: **жирный**, `код`, списки и абзацы. Без HTML — только React-узлы. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<b key={i++}>{tok.slice(2, -2)}</b>);
    else out.push(<code key={i++}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, idx) => {
        if (!line.trim()) return <div key={idx} className="rt-gap" />;
        const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <div key={idx} className="rt-li">
              <span className="rt-marker">•</span>
              <span className="rt-li-text">{inline(bullet[1])}</span>
            </div>
          );
        }
        const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
        if (numbered) {
          return (
            <div key={idx} className="rt-li">
              <span className="rt-marker">{numbered[1]}.</span>
              <span className="rt-li-text">{inline(numbered[2])}</span>
            </div>
          );
        }
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        return (
          <div key={idx} className="rt-p">
            {heading ? <b>{inline(heading[1])}</b> : <Fragment>{inline(line)}</Fragment>}
          </div>
        );
      })}
    </>
  );
}
