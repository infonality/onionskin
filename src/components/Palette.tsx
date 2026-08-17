import { CornerDownLeft, FileText, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { scanMarkdownFiles, type FsEntry } from "../lib/ipc";
import { dirname, prettyPath } from "../lib/path";
import { openPath } from "../state/actions";
import { prettyKeys, type AppCommand } from "../state/commands";
import { useStore } from "../state/store";

/** Subsequence match with a bonus for hits at word boundaries. */
export function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 1;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();

  let score = 0;
  let hi = 0;
  let streak = 0;

  for (let ni = 0; ni < n.length; ni++) {
    const ch = n[ni];
    if (ch === " ") continue;
    const found = h.indexOf(ch, hi);
    if (found < 0) return 0;
    const boundary = found === 0 || /[\s/\\._-]/.test(h[found - 1]);
    streak = found === hi ? streak + 1 : 0;
    score += 1 + (boundary ? 6 : 0) + streak * 2;
    hi = found + 1;
  }
  // Prefer shorter targets when scores are otherwise close.
  return score + Math.max(0, 24 - haystack.length) * 0.15;
}

interface Item {
  key: string;
  title: string;
  subtitle?: string;
  keys?: string;
  run: () => void;
}

export function Palette({ commands }: { commands: AppCommand[] }) {
  const paletteOpen = useStore((s) => s.paletteOpen);
  const quickOpen = useStore((s) => s.quickOpen);
  const folder = useStore((s) => s.folder);
  const docs = useStore((s) => s.docs);
  const home = useStore((s) => s.home);
  const setPalette = useStore((s) => s.setPalette);
  const setQuickOpen = useStore((s) => s.setQuickOpen);

  const open = paletteOpen || quickOpen;
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [files, setFiles] = useState<FsEntry[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setPalette(false);
    setQuickOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!quickOpen || !folder) return;
    let cancelled = false;
    void scanMarkdownFiles(folder, 3000).then((entries) => {
      if (!cancelled) setFiles(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [quickOpen, folder]);

  const items = useMemo<Item[]>(() => {
    if (quickOpen) {
      const openDocs: Item[] = docs
        .filter((d) => d.path)
        .map((d) => ({
          key: `open:${d.id}`,
          title: d.name,
          subtitle: "Open tab",
          run: () => useStore.getState().setActive(d.id),
        }));

      const fileItems: Item[] = files
        .filter((f) => !docs.some((d) => d.path === f.path))
        .map((f) => ({
          key: f.path,
          title: f.name,
          subtitle: prettyPath(dirname(f.path), home),
          run: () => void openPath(f.path),
        }));

      return [...openDocs, ...fileItems];
    }

    return commands.map((c) => ({
      key: c.id,
      title: c.label,
      subtitle: c.group,
      keys: c.keys,
      run: () => void c.run(),
    }));
  }, [quickOpen, commands, docs, files, home]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return items.slice(0, 60);
    return items
      .map((item) => ({
        item,
        score: Math.max(
          fuzzyScore(item.title, q),
          fuzzyScore(`${item.subtitle ?? ""} ${item.title}`, q) * 0.8,
        ),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((r) => r.item);
  }, [items, query]);

  useEffect(() => {
    setIndex(0);
  }, [query, quickOpen]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(".palette-row.is-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [index, filtered]);

  if (!open) return null;

  const commit = (item?: Item) => {
    const target = item ?? filtered[index];
    close();
    target?.run();
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="palette-field">
          {quickOpen ? <FileText size={16} strokeWidth={1.7} /> : <Search size={16} strokeWidth={1.7} />}
          <input
            ref={inputRef}
            value={query}
            spellCheck={false}
            placeholder={quickOpen ? "Go to file…" : "Type a command…"}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
          />
        </div>

        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="palette-empty">
              {quickOpen && !folder ? "Open a folder to search files." : "No matches."}
            </div>
          ) : null}
          {filtered.map((item, i) => (
            <button
              key={item.key}
              type="button"
              className={`palette-row${i === index ? " is-active" : ""}`}
              onMouseMove={() => setIndex(i)}
              onClick={() => commit(item)}
            >
              <span className="palette-title">{item.title}</span>
              {item.subtitle ? <span className="palette-sub">{item.subtitle}</span> : null}
              {item.keys ? <span className="palette-keys">{prettyKeys(item.keys)}</span> : null}
            </button>
          ))}
        </div>

        <div className="palette-footer">
          <span>
            <CornerDownLeft size={12} strokeWidth={2} /> open
          </span>
          <span>↑↓ navigate</span>
          <span>esc dismiss</span>
        </div>
      </div>
    </div>
  );
}
