import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, Maximize2, Minus, PanelLeft, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { revealEntry } from "../lib/ipc";
import { closeTab, newDocument, saveDoc, schedulePersist } from "../state/actions";
import { MENU_MODEL, prettyKeys, type AppCommand } from "../state/commands";
import { useStore, type OpenDoc } from "../state/store";
import { openContextMenu, type MenuNode } from "./ContextMenu";

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function AppMenu({ commands }: { commands: AppCommand[] }) {
  const [openSection, setOpenSection] = useState<string | null>(null);
  const ref = useOutsideClose(openSection !== null, () => setOpenSection(null));
  const byId = new Map(commands.map((c) => [c.id, c]));

  return (
    <div className="app-menu" ref={ref}>
      <button
        type="button"
        className={`titlebar-btn menu-trigger${openSection ? " is-active" : ""}`}
        title="Menu"
        aria-haspopup="menu"
        onClick={() => setOpenSection((s) => (s ? null : MENU_MODEL[0].label))}
      >
        <span className="menu-glyph" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      {openSection ? (
        <div className="menu-popover" role="menu">
          <div className="menu-columns">
            {MENU_MODEL.map((section) => (
              <button
                key={section.label}
                type="button"
                className={`menu-tab${section.label === openSection ? " is-active" : ""}`}
                onMouseEnter={() => setOpenSection(section.label)}
                onClick={() => setOpenSection(section.label)}
              >
                {section.label}
              </button>
            ))}
          </div>
          <div className="menu-items">
            {MENU_MODEL.find((s) => s.label === openSection)?.items.map((item, i) => {
              if (item === "-") return <div className="menu-sep" key={`sep-${i}`} />;
              const cmd = byId.get(item);
              if (!cmd) return null;
              return (
                <button
                  key={cmd.id}
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setOpenSection(null);
                    void cmd.run();
                  }}
                >
                  <span className="menu-check">{cmd.checked ? "✓" : ""}</span>
                  <span className="menu-label">{cmd.label}</span>
                  {cmd.keys ? <span className="menu-keys">{prettyKeys(cmd.keys)}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** `getCurrentWindow` throws outside the Tauri shell (e.g. `vite dev` in a browser). */
function appWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = appWindow();
    if (!win) return;
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized);
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  const win = appWindow();
  if (!win) return null;

  return (
    <div className="window-controls">
      <button type="button" className="win-btn" title="Minimize" onClick={() => void win.minimize()}>
        <Minus size={15} strokeWidth={1.6} />
      </button>
      <button
        type="button"
        className="win-btn"
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? <Copy size={12} strokeWidth={1.6} /> : <Maximize2 size={12} strokeWidth={1.6} />}
      </button>
      <button
        type="button"
        className="win-btn win-close"
        title="Close"
        onClick={() => void win.close()}
      >
        <X size={15} strokeWidth={1.6} />
      </button>
    </div>
  );
}

function Tabs() {
  const docs = useStore((s) => s.docs);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  const reorderDocs = useStore((s) => s.reorderDocs);
  const stripRef = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<number | null>(null);

  const tabMenu = (doc: OpenDoc): MenuNode[] => {
    const others = docs.filter((d) => d.id !== doc.id);
    const saved = docs.filter((d) => d.text === d.savedText);
    return [
      { label: "Save", keys: "Mod+S", disabled: doc.text === doc.savedText, run: () => void saveDoc(doc.id) },
      { label: "Save As…", run: () => void saveDoc(doc.id, { saveAs: true }) },
      "-",
      { label: "Close", keys: "Mod+W", run: () => void closeTab(doc.id) },
      {
        label: "Close Others",
        disabled: !others.length,
        run: async () => {
          for (const d of others) if (!(await closeTab(d.id))) return;
        },
      },
      {
        label: "Close Saved",
        disabled: !saved.length,
        run: async () => {
          for (const d of saved) if (!(await closeTab(d.id))) return;
        },
      },
      {
        label: "Close All",
        run: async () => {
          for (const d of [...docs]) if (!(await closeTab(d.id))) return;
        },
      },
      "-",
      {
        label: "Copy File Path",
        disabled: !doc.path,
        run: () => void writeText(doc.path ?? ""),
      },
      {
        label: "Show in File Manager",
        disabled: !doc.path,
        run: () => void revealEntry(doc.path ?? ""),
      },
      "-",
      { label: "New Document", keys: "Mod+N", run: () => newDocument() },
    ];
  };

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(".tab.is-active");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  return (
    <div className="tab-strip" ref={stripRef}>
      {docs.map((doc, index) => {
        const dirty = doc.text !== doc.savedText;
        return (
          <div
            key={doc.id}
            className={`tab${doc.id === activeId ? " is-active" : ""}${dirty ? " is-dirty" : ""}`}
            title={doc.path ?? doc.name}
            draggable
            onDragStart={() => {
              dragFrom.current = index;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragFrom.current != null && dragFrom.current !== index) {
                reorderDocs(dragFrom.current, index);
              }
              dragFrom.current = null;
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                void closeTab(doc.id);
              } else if (e.button === 0) {
                setActive(doc.id);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActive(doc.id);
              openContextMenu(e.clientX, e.clientY, tabMenu(doc));
            }}
          >
            <span className="tab-name">{doc.name}</span>
            <button
              type="button"
              className="tab-close"
              title="Close tab"
              aria-label={`Close ${doc.name}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(doc.id);
              }}
            >
              {dirty ? <span className="dirty-dot" /> : <X size={13} strokeWidth={2} />}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="tab-new"
        title="New document (Ctrl+N)"
        onClick={() => newDocument()}
      >
        <Plus size={15} strokeWidth={1.8} />
      </button>
    </div>
  );
}

export function TitleBar({ commands }: { commands: AppCommand[] }) {
  const platform = useStore((s) => s.platform);
  const sidebarVisible = useStore((s) => s.settings.sidebarVisible);
  const patchSettings = useStore((s) => s.patchSettings);
  const isMac = platform === "macos";

  return (
    <header className={`titlebar${isMac ? " is-mac" : ""}`} data-tauri-drag-region>
      <div className="titlebar-left">
        {isMac ? <div className="mac-gutter" /> : <AppMenu commands={commands} />}
        <button
          type="button"
          className={`titlebar-btn${sidebarVisible ? " is-active" : ""}`}
          title="Toggle sidebar (Ctrl+\\)"
          onClick={() => {
            patchSettings({ sidebarVisible: !sidebarVisible });
            schedulePersist();
          }}
        >
          <PanelLeft size={16} strokeWidth={1.7} />
        </button>
      </div>

      <Tabs />

      <div className="titlebar-drag" data-tauri-drag-region />

      {isMac ? null : <WindowControls />}
    </header>
  );
}
