import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { listDirectory, revealEntry, type FsEntry } from "../lib/ipc";
import { basename, dirname } from "../lib/path";
import {
  createFileIn,
  createFolderIn,
  deletePath,
  openFolderDialog,
  openPath,
  renamePath,
} from "../state/actions";
import { useStore } from "../state/store";
import { openContextMenu, type MenuNode } from "./ContextMenu";

interface TreeProps {
  root: string;
}

function Row({
  entry,
  depth,
  expanded,
  isActive,
  renaming,
  onToggle,
  onOpen,
  onContext,
  onRenameCommit,
  onRenameCancel,
}: {
  entry: FsEntry;
  depth: number;
  expanded: boolean;
  isActive: boolean;
  renaming: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onContext: (e: React.MouseEvent) => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
}) {
  return (
    <div
      className={`tree-row${isActive ? " is-active" : ""}${entry.isDir ? " is-dir" : ""}`}
      style={{ paddingLeft: 8 + depth * 13 }}
      onClick={() => (entry.isDir ? onToggle() : onOpen())}
      onContextMenu={onContext}
      title={entry.path}
    >
      <span className={`tree-caret${expanded ? " is-open" : ""}`}>
        {entry.isDir && entry.hasChildren ? <ChevronRight size={13} strokeWidth={2.2} /> : null}
      </span>
      <span className="tree-icon">
        {entry.isDir ? (
          expanded ? (
            <FolderOpen size={14} strokeWidth={1.7} />
          ) : (
            <Folder size={14} strokeWidth={1.7} />
          )
        ) : (
          <FileText size={14} strokeWidth={1.7} />
        )}
      </span>
      {renaming ? (
        <input
          className="tree-rename"
          defaultValue={entry.name}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => {
            const dot = e.target.value.lastIndexOf(".");
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
          }}
          onBlur={(e) => onRenameCommit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRenameCommit((e.target as HTMLInputElement).value);
            if (e.key === "Escape") onRenameCancel();
          }}
        />
      ) : (
        <span className="tree-name">{entry.name}</span>
      )}
    </div>
  );
}

export function FileTree({ root }: TreeProps) {
  const showAll = useStore((s) => s.settings.showAllFiles);
  const activePath = useStore((s) => s.activeDoc()?.path ?? null);

  const [children, setChildren] = useState<Map<string, FsEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (dir: string) => {
      try {
        const entries = await listDirectory(dir, showAll);
        setChildren((prev) => new Map(prev).set(dir, entries));
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    },
    [showAll],
  );

  useEffect(() => {
    setChildren(new Map());
    setExpanded(new Set());
    void load(root);
  }, [root, load]);

  // Reload every folder that is currently open when the filter changes.
  useEffect(() => {
    for (const dir of expanded) void load(dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

  const toggle = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) {
        next.delete(dir);
      } else {
        next.add(dir);
        if (!children.has(dir)) void load(dir);
      }
      return next;
    });
  };

  const refresh = (dir: string) => {
    void load(dir);
    if (!expanded.has(dir) && dir !== root) {
      setExpanded((prev) => new Set(prev).add(dir));
    }
  };

  const contextActions = (entry: FsEntry | null): MenuNode[] => {
    const dir = entry ? (entry.isDir ? entry.path : dirname(entry.path)) : root;
    const actions: MenuNode[] = [];

    if (entry && !entry.isDir) {
      actions.push(
        { label: "Open", run: () => void openPath(entry.path) },
        "-",
      );
    }

    actions.push(
      {
        label: "New Document",
        run: async () => {
          await createFileIn(dir);
          refresh(dir);
        },
      },
      {
        label: "New Folder",
        run: async () => {
          await createFolderIn(dir);
          refresh(dir);
        },
      },
    );

    if (entry) {
      actions.push(
        "-",
        { label: "Rename…", run: () => setRenaming(entry.path) },
        { label: "Copy Path", run: () => void writeText(entry.path) },
        { label: "Reveal in File Manager", run: () => void revealEntry(entry.path) },
        "-",
        {
          label: "Move to Trash",
          danger: true,
          run: async () => {
            if (await deletePath(entry.path)) refresh(dirname(entry.path));
          },
        },
      );
    } else {
      actions.push(
        "-",
        { label: "Refresh", run: () => refresh(root) },
        { label: "Copy Folder Path", run: () => void writeText(root) },
        { label: "Reveal in File Manager", run: () => void revealEntry(root) },
        "-",
        { label: "Open Another Folder…", run: () => void openFolderDialog() },
      );
    }
    return actions;
  };

  const rows: React.ReactNode[] = [];
  const walk = (dir: string, depth: number) => {
    for (const entry of children.get(dir) ?? []) {
      const isOpen = expanded.has(entry.path);
      rows.push(
        <Row
          key={entry.path}
          entry={entry}
          depth={depth}
          expanded={isOpen}
          isActive={entry.path === activePath}
          renaming={renaming === entry.path}
          onToggle={() => toggle(entry.path)}
          onOpen={() => void openPath(entry.path)}
          onContext={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openContextMenu(e.clientX, e.clientY, contextActions(entry));
          }}
          onRenameCommit={async (name) => {
            setRenaming(null);
            const trimmed = name.trim();
            if (trimmed && trimmed !== entry.name) {
              await renamePath(entry.path, trimmed);
              refresh(dirname(entry.path));
            }
          }}
          onRenameCancel={() => setRenaming(null)}
        />,
      );
      if (entry.isDir && isOpen) walk(entry.path, depth + 1);
    }
  };
  walk(root, 0);

  return (
    <div
      className="file-tree"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openContextMenu(e.clientX, e.clientY, contextActions(null));
      }}
    >
      <div className="tree-root-label" title={root}>
        {basename(root) || root}
      </div>
      {error ? <div className="tree-empty">{error}</div> : null}
      {!error && rows.length === 0 ? (
        <div className="tree-empty">
          This folder has no {showAll ? "files" : "Markdown files"} yet.
        </div>
      ) : null}
      {rows}
    </div>
  );
}
