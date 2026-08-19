import { Code2, Crosshair, Settings as SettingsIcon, Type } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CaretStats } from "../editor/Editor";
import { prettyPath } from "../lib/path";
import { countWords } from "../lib/text";
import { schedulePersist } from "../state/actions";
import { prettyKeys } from "../state/commands";
import { useStore } from "../state/store";

export function StatusBar({ stats }: { stats: CaretStats }) {
  const doc = useStore((s) => s.activeDoc());
  const home = useStore((s) => s.home);
  const settings = useStore((s) => s.settings);
  const patchSettings = useStore((s) => s.patchSettings);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [text, setText] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setText(doc?.text ?? ""), 250);
    return () => window.clearTimeout(id);
  }, [doc?.text]);

  const words = useMemo(() => countWords(text), [text]);
  const characters = text.length;
  const minutes = Math.max(1, Math.round(words / 220));

  const toggle = (key: "sourceMode" | "focusMode" | "typewriter") => {
    patchSettings({ [key]: !settings[key] } as never);
    schedulePersist();
  };

  return (
    <footer className="statusbar">
      <div className="status-left" title={doc?.path ?? undefined}>
        {doc?.path ? prettyPath(doc.path, home) : (doc?.name ?? "No document")}
        {doc && doc.text !== doc.savedText ? <span className="status-dot" /> : null}
      </div>

      <div className="status-right">
        {stats.selected > 0 ? (
          <span className="status-item">
            {stats.selectedWords.toLocaleString()} words, {stats.selected.toLocaleString()} chars
            selected
          </span>
        ) : null}
        <span className="status-item">
          Ln {stats.line}, Col {stats.column}
        </span>
        <span className="status-item">{words.toLocaleString()} words</span>
        <span className="status-item status-hide-sm">{characters.toLocaleString()} chars</span>
        <span className="status-item status-hide-sm">{minutes} min read</span>
        <span className="status-item status-hide-sm">
          {doc?.lineEnding === "crlf" ? "CRLF" : "LF"}
        </span>

        <span className="status-sep" />

        <button
          type="button"
          className={`status-toggle${settings.focusMode ? " is-on" : ""}`}
          title="Focus mode (Ctrl+Shift+F)"
          onClick={() => toggle("focusMode")}
        >
          <Crosshair size={13} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          className={`status-toggle${settings.typewriter ? " is-on" : ""}`}
          title="Typewriter mode"
          onClick={() => toggle("typewriter")}
        >
          <Type size={13} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          className={`status-toggle${settings.sourceMode ? " is-on" : ""}`}
          title="Source mode (Ctrl+/)"
          onClick={() => toggle("sourceMode")}
        >
          <Code2 size={13} strokeWidth={1.9} />
        </button>

        <span className="status-sep" />

        <button
          type="button"
          className={`status-toggle status-gear${settingsOpen ? " is-on" : ""}`}
          title={`Settings (${prettyKeys("Mod+,")})`}
          aria-label="Settings"
          aria-haspopup="dialog"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon size={14} strokeWidth={1.9} />
        </button>
      </div>
    </footer>
  );
}
