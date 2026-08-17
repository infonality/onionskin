import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchInFolder, type SearchHit } from "../lib/ipc";
import { useStore } from "../state/store";

interface Props {
  onOpenHit: (path: string, line: number) => void;
}

/** Highlights the matched substring inside a result line. */
function Snippet({ text, query }: { text: string; query: string }) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0 || !query) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function SearchPanel({ onOpenHit }: Props) {
  const folder = useStore((s) => s.folder);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!folder || query.trim().length < 2) {
      setHits([]);
      setBusy(false);
      return;
    }
    const id = ++requestId.current;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const results = await searchInFolder(folder, query.trim(), 300);
        if (requestId.current === id) setHits(results);
      } finally {
        if (requestId.current === id) setBusy(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [folder, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      const list = map.get(hit.path);
      if (list) list.push(hit);
      else map.set(hit.path, [hit]);
    }
    return [...map.entries()];
  }, [hits]);

  if (!folder) {
    return <div className="panel-empty">Open a folder to search across files.</div>;
  }

  return (
    <div className="search-panel">
      <div className="search-field">
        <Search size={14} strokeWidth={1.8} />
        <input
          ref={inputRef}
          value={query}
          placeholder="Search in folder…"
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        {query ? (
          <button type="button" className="icon-btn" onClick={() => setQuery("")} title="Clear">
            <X size={13} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      <div className="search-meta">
        {busy
          ? "Searching…"
          : query.trim().length < 2
            ? "Type at least two characters."
            : `${hits.length} match${hits.length === 1 ? "" : "es"} in ${grouped.length} file${
                grouped.length === 1 ? "" : "s"
              }`}
      </div>

      <div className="search-results">
        {grouped.map(([path, items]) => (
          <div className="search-group" key={path}>
            <div className="search-file" title={path}>
              {items[0].name}
              <span className="search-count">{items.length}</span>
            </div>
            {items.map((hit, i) => (
              <button
                key={`${hit.line}-${i}`}
                type="button"
                className="search-hit"
                onClick={() => onOpenHit(hit.path, hit.line)}
              >
                <span className="search-line">{hit.line}</span>
                <span className="search-text">
                  <Snippet text={hit.text} query={query.trim()} />
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
