import type { EditorView } from "@codemirror/view";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmHost } from "./components/Confirm";
import { ContextMenuHost, openContextMenu } from "./components/ContextMenu";
import { Palette } from "./components/Palette";
import { SettingsSheet, ShortcutsSheet } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { Toasts } from "./components/Toasts";
import { Editor, type CaretStats } from "./editor/Editor";
import { insertImage } from "./editor/commands";
import { buildEditorMenu } from "./editor/contextMenu";
import { buildStandaloneHtml, renderDocumentFragment } from "./lib/export";
import { dirname, extname, relative } from "./lib/path";
import { buildTextFieldMenu } from "./lib/textFieldMenu";
import { resolveTheme } from "./lib/themes";
import * as actions from "./state/actions";
import { useAppCommands, type AppCommand } from "./state/commands";
import { useStore } from "./state/store";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp"];

function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  const lightPalette = useStore((s) => s.settings.lightPalette);
  const darkPalette = useStore((s) => s.settings.darkPalette);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      const mode = dark ? "dark" : "light";
      const palette = resolveTheme(dark ? darkPalette : lightPalette, mode);
      document.documentElement.dataset.theme = mode;
      document.documentElement.dataset.palette = palette;
    };
    apply();

    // Mirrored into localStorage so the pre-paint script in index.html can
    // apply the same colours before React mounts.
    localStorage.setItem("onionskin.theme", theme);
    localStorage.setItem("onionskin.palette.light", lightPalette);
    localStorage.setItem("onionskin.palette.dark", darkPalette);

    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, lightPalette, darkPalette]);
}

/** Mirrors typography settings onto CSS custom properties. */
function useTypography() {
  const { fontSize, typeface, contentWidth } = useStore((s) => s.settings);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--editor-font-size", `${fontSize}px`);
    root.dataset.typeface = typeface;
    root.dataset.width = contentWidth;
  }, [fontSize, typeface, contentWidth]);
}

export default function App() {
  const docs = useStore((s) => s.docs);
  const activeId = useStore((s) => s.activeId);
  const settings = useStore((s) => s.settings);
  const activeDoc = useMemo(
    () => docs.find((d) => d.id === activeId) ?? null,
    [docs, activeId],
  );

  const viewRef = useRef<EditorView | null>(null);
  const [, forceRender] = useState(0);
  const [stats, setStats] = useState<CaretStats>({ line: 1, column: 1, selected: 0, selectedWords: 0 });
  const [printFragment, setPrintFragment] = useState<string | null>(null);

  useTheme();
  useTypography();

  const getView = useCallback(() => viewRef.current, []);

  const requestExportHtml = useCallback(async () => {
    const doc = useStore.getState().activeDoc();
    if (!doc) return;
    const fragment = renderDocumentFragment(doc.text, doc.path);
    await actions.exportHtml(buildStandaloneHtml(doc.name, fragment), doc.name);
  }, []);

  const requestPrint = useCallback(() => {
    const doc = useStore.getState().activeDoc();
    if (!doc) return;
    setPrintFragment(renderDocumentFragment(doc.text, doc.path));
  }, []);

  const commandContext = useMemo(
    () => ({ getView, requestPrint, requestExportHtml }),
    [getView, requestPrint, requestExportHtml],
  );
  const commands: AppCommand[] = useAppCommands(commandContext);
  const commandMap = useMemo(() => new Map(commands.map((c) => [c.id, c])), [commands]);

  // --- printing -------------------------------------------------------------
  useEffect(() => {
    if (printFragment == null) return;
    const done = () => setPrintFragment(null);
    window.addEventListener("afterprint", done);
    const id = window.setTimeout(() => window.print(), 80);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("afterprint", done);
    };
  }, [printFragment]);

  // --- startup --------------------------------------------------------------
  useEffect(() => {
    void actions.bootstrap();
  }, []);

  useEffect(() => {
    document.title = activeDoc
      ? `${activeDoc.text !== activeDoc.savedText ? "• " : ""}${activeDoc.name} — Onionskin`
      : "Onionskin";
  }, [activeDoc]);

  // --- native menu + window events -----------------------------------------
  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    void listen<string>("menu-action", (event) => {
      commandMap.get(event.payload)?.run();
    }).then((fn) => unlisteners.push(fn));

    void listen("close-requested", () => {
      void actions.requestAppClose();
    }).then((fn) => unlisteners.push(fn));

    return () => unlisteners.forEach((fn) => fn());
  }, [commandMap]);

  // --- context menus --------------------------------------------------------
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      // Shift falls through to the webview's own menu (spelling suggestions).
      // Otherwise the native menu is suppressed and anything unhandled here
      // simply shows nothing.
      if (event.shiftKey || !target || target.closest(".context-menu")) return;

      const field = target.closest("input, textarea") as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
      if (field) {
        event.preventDefault();
        openContextMenu(event.clientX, event.clientY, buildTextFieldMenu(field));
        return;
      }

      const view = viewRef.current;
      if (view && target.closest(".cm-editor")) {
        event.preventDefault();
        openContextMenu(
          event.clientX,
          event.clientY,
          buildEditorMenu(view, event, {
            docPath: useStore.getState().activeDoc()?.path ?? null,
          }),
        );
      }
    };

    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // --- auto-save ------------------------------------------------------------
  // `docs` gets a new identity on every keystroke, so this debounces to 1.5s
  // after typing stops. Untitled documents are skipped — they need a dialog.
  const autoSave = useStore((s) => s.settings.autoSave);
  useEffect(() => {
    if (!autoSave) return;
    const id = window.setTimeout(() => void actions.saveDirtyToDisk(), 1500);
    return () => window.clearTimeout(id);
  }, [autoSave, docs]);

  useEffect(() => {
    if (!autoSave) return;
    const flush = () => void actions.saveDirtyToDisk();
    window.addEventListener("blur", flush);
    return () => window.removeEventListener("blur", flush);
  }, [autoSave]);

  // --- external edits -------------------------------------------------------
  useEffect(() => {
    const onFocus = () => void actions.checkDiskChanges();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // --- drag and drop --------------------------------------------------------
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let webview: ReturnType<typeof getCurrentWebview>;
    try {
      webview = getCurrentWebview();
    } catch {
      return;
    }
    void webview
      .onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        for (const path of event.payload.paths) {
          const ext = extname(path);
          if (IMAGE_EXTS.includes(ext)) {
            const view = viewRef.current;
            const doc = useStore.getState().activeDoc();
            if (!view) continue;
            const base = doc?.path ? dirname(doc.path) : null;
            const href = (base ? relative(base, path) : path).replace(/ /g, "%20");
            insertImage(href)(view);
          } else {
            await actions.openPath(path);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  // --- global keyboard ------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;

      // Overlays own the keyboard while they are up.
      const s = useStore.getState();
      if (s.paletteOpen || s.quickOpen || s.settingsOpen || s.shortcutsOpen) return;

      if (mod && event.key === "Tab") {
        event.preventDefault();
        const state = useStore.getState();
        if (state.docs.length < 2) return;
        const i = state.docs.findIndex((d) => d.id === state.activeId);
        const next = event.shiftKey
          ? (i - 1 + state.docs.length) % state.docs.length
          : (i + 1) % state.docs.length;
        state.setActive(state.docs[next].id);
        return;
      }

      if (event.key === "F11") {
        event.preventDefault();
        void commandMap.get("toggle-fullscreen")?.run();
        return;
      }

      if (!mod) return;
      const key = event.key.toLowerCase();

      // Commands the editor keymap does not own, so they work from anywhere.
      const table: Record<string, string> = {
        n: "new",
        o: event.shiftKey ? "open-folder" : "open",
        s: event.shiftKey ? "save-as" : "save",
        w: "close-tab",
        p: event.shiftKey ? "palette" : "export-pdf",
        k: "quick-open",
        ",": "settings",
        "/": "toggle-source",
        "\\": event.shiftKey ? "toggle-outline" : "toggle-sidebar",
      };

      if (event.shiftKey && key === "d") {
        event.preventDefault();
        void commandMap.get("theme-toggle")?.run();
        return;
      }
      if (event.shiftKey && key === "f") {
        event.preventDefault();
        void commandMap.get("toggle-focus")?.run();
        return;
      }
      if (key === "=" || key === "+") {
        event.preventDefault();
        void commandMap.get(event.shiftKey ? "zoom-reset" : "zoom-in")?.run();
        return;
      }
      if (key === "-") {
        event.preventDefault();
        void commandMap.get("zoom-out")?.run();
        return;
      }

      const id = table[key];
      if (!id) return;
      event.preventDefault();
      void commandMap.get(id)?.run();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandMap]);

  // --- editor plumbing ------------------------------------------------------
  const onReady = useCallback((view: EditorView | null) => {
    viewRef.current = view;
    forceRender((n) => n + 1);
  }, []);

  const onChange = useCallback(
    (text: string) => {
      const state = useStore.getState();
      if (state.activeId) state.setText(state.activeId, text);
    },
    [],
  );

  const onOpenLink = useCallback((href: string) => {
    void actions.followLink(href, useStore.getState().activeDoc());
  }, []);

  const jumpToLine = useCallback(async (path: string, line: number) => {
    await actions.openPath(path);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const view = viewRef.current;
        if (!view) return;
        const target = view.state.doc.line(Math.min(line, view.state.doc.lines));
        view.dispatch({ selection: { anchor: target.to }, scrollIntoView: true });
        view.focus();
      }),
    );
  }, []);

  // Persist the session whenever the set of open documents changes.
  const folder = useStore((s) => s.folder);
  useEffect(() => {
    actions.schedulePersist();
  }, [docs.length, activeId, folder]);

  return (
    <div className={`app${settings.focusMode ? " is-focus" : ""}`}>
      <TitleBar commands={commands} />

      <div className="workspace">
        <Sidebar view={viewRef.current} onOpenHit={jumpToLine} />

        <main className="editor-pane">
          {activeDoc ? (
            <Editor
              docId={activeDoc.id}
              docPath={activeDoc.path}
              initialText={activeDoc.text}
              revision={activeDoc.revision}
              settings={{
                sourceMode: settings.sourceMode,
                focusMode: settings.focusMode,
                typewriter: settings.typewriter,
                spellcheck: settings.spellcheck,
              }}
              onChange={onChange}
              onStats={setStats}
              onReady={onReady}
              onOpenLink={onOpenLink}
            />
          ) : (
            <div className="empty-state">
              <h1>Onionskin</h1>
              <p>A quiet place to write Markdown.</p>
              <div className="empty-actions">
                <button type="button" className="btn btn-primary" onClick={() => actions.newDocument()}>
                  New Document
                </button>
                <button type="button" className="btn" onClick={() => void actions.openFileDialog()}>
                  Open File…
                </button>
                <button type="button" className="btn" onClick={() => void actions.openFolderDialog()}>
                  Open Folder…
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      <StatusBar stats={stats} />

      <Palette commands={commands} />
      <SettingsSheet />
      <ShortcutsSheet />
      <Toasts />
      <ConfirmHost />
      <ContextMenuHost />

      {printFragment != null ? (
        <div id="print-root" dangerouslySetInnerHTML={{ __html: printFragment }} />
      ) : null}
    </div>
  );
}
