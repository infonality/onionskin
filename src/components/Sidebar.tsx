import type { EditorView } from "@codemirror/view";
import { FolderOpen, List, Search } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { openFolderDialog, schedulePersist } from "../state/actions";
import { useStore, type SidebarTab } from "../state/store";
import { FileTree } from "./FileTree";
import { Outline } from "./Outline";
import { SearchPanel } from "./SearchPanel";

const TABS: Array<{ id: SidebarTab; label: string; icon: typeof List }> = [
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "outline", label: "Outline", icon: List },
  { id: "search", label: "Search", icon: Search },
];

export function Sidebar({
  view,
  onOpenHit,
}: {
  view: EditorView | null;
  onOpenHit: (path: string, line: number) => void;
}) {
  const settings = useStore((s) => s.settings);
  const folder = useStore((s) => s.folder);
  const patchSettings = useStore((s) => s.patchSettings);
  const dragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const width = Math.min(460, Math.max(180, e.clientX));
      useStore.getState().patchSettings({ sidebarWidth: width });
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      schedulePersist();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  if (!settings.sidebarVisible) return null;

  return (
    <aside className="sidebar" style={{ width: settings.sidebarWidth }}>
      <nav className="sidebar-tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`sidebar-tab${settings.sidebarTab === id ? " is-active" : ""}`}
            title={label}
            onClick={() => {
              patchSettings({ sidebarTab: id });
              schedulePersist();
            }}
          >
            <Icon size={15} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-body">
        {settings.sidebarTab === "files" ? (
          folder ? (
            <FileTree root={folder} />
          ) : (
            <div className="panel-empty">
              No folder open.
              <button type="button" className="btn btn-primary" onClick={() => void openFolderDialog()}>
                Open Folder…
              </button>
            </div>
          )
        ) : null}
        {settings.sidebarTab === "outline" ? <Outline view={view} /> : null}
        {settings.sidebarTab === "search" ? <SearchPanel onOpenHit={onOpenHit} /> : null}
      </div>

      <div className="sidebar-resizer" onPointerDown={onPointerDown} title="Drag to resize" />
    </aside>
  );
}
