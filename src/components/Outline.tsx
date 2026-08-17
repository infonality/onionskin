import type { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";

interface Heading {
  level: number;
  text: string;
  line: number;
}

/** Extracts ATX headings, skipping anything inside fenced code. */
export function parseHeadings(source: string): Heading[] {
  const out: Heading[] = [];
  const lines = source.split("\n");
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;

    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m && m[2]) {
      out.push({ level: m[1].length, text: m[2], line: i + 1 });
      continue;
    }

    // Setext headings: underlined by === or ---
    if (i > 0 && /^\s{0,3}(=+|-{2,})\s*$/.test(line) && lines[i - 1].trim()) {
      const prev = lines[i - 1].trim();
      if (!/^([-*_]\s*){3,}$/.test(prev)) {
        out.push({ level: line.trim().startsWith("=") ? 1 : 2, text: prev, line: i });
      }
    }
  }
  return out;
}

export function Outline({ view }: { view: EditorView | null }) {
  const doc = useStore((s) => s.activeDoc());
  const [text, setText] = useState(doc?.text ?? "");
  const [caretLine, setCaretLine] = useState(1);

  // Re-parsing on every keystroke is wasteful; a short delay is imperceptible.
  useEffect(() => {
    const id = window.setTimeout(() => setText(doc?.text ?? ""), 220);
    return () => window.clearTimeout(id);
  }, [doc?.text]);

  useEffect(() => {
    if (!view) return;
    const id = window.setInterval(() => {
      const head = view.state.selection.main.head;
      setCaretLine(view.state.doc.lineAt(head).number);
    }, 400);
    return () => window.clearInterval(id);
  }, [view]);

  const headings = useMemo(() => parseHeadings(text), [text]);

  const activeIndex = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].line <= caretLine) idx = i;
      else break;
    }
    return idx;
  }, [headings, caretLine]);

  if (!doc) return <div className="panel-empty">No document open.</div>;
  if (!headings.length) {
    return (
      <div className="panel-empty">
        No headings yet.
        <span className="panel-empty-hint">Start a line with # to create one.</span>
      </div>
    );
  }

  const minLevel = Math.min(...headings.map((h) => h.level));

  return (
    <div className="outline">
      {headings.map((h, i) => (
        <button
          key={`${h.line}-${i}`}
          type="button"
          className={`outline-row lvl-${h.level}${i === activeIndex ? " is-active" : ""}`}
          style={{ paddingLeft: 12 + (h.level - minLevel) * 14 }}
          title={h.text}
          onClick={() => {
            if (!view) return;
            const line = view.state.doc.line(Math.min(h.line, view.state.doc.lines));
            view.dispatch({
              selection: { anchor: line.to },
              effects: [],
              scrollIntoView: true,
            });
            view.focus();
          }}
        >
          {h.text}
        </button>
      ))}
    </div>
  );
}
