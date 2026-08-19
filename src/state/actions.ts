import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { confirmDialog } from "../components/Confirm";
import * as ipc from "../lib/ipc";
import { basename, dirname, extname, stem } from "../lib/path";
import { useStore, type OpenDoc } from "./store";

const MARKDOWN_FILTER = [
  { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "mdx"] },
  { name: "Text", extensions: ["txt", "text"] },
  { name: "All Files", extensions: ["*"] },
];

function fail(error: unknown) {
  const message = typeof error === "string" ? error : ((error as Error)?.message ?? String(error));
  useStore.getState().pushToast(message, "error");
}

// --- opening ---------------------------------------------------------------

export async function openPath(path: string) {
  const state = useStore.getState();
  const existing = state.docs.find((d) => d.path === path);
  if (existing) {
    state.setActive(existing.id);
    state.noteRecentFile(path);
    return existing.id;
  }

  try {
    const doc = await ipc.readDocument(path);
    state.addDoc({
      id: doc.path,
      path: doc.path,
      name: doc.name,
      text: doc.content,
      savedText: doc.content,
      lineEnding: doc.lineEnding,
      diskModified: doc.modified,
    });
    state.noteRecentFile(doc.path);
    schedulePersist();
    return doc.path;
  } catch (error) {
    fail(error);
    return null;
  }
}

export function newDocument(initialText = "") {
  const state = useStore.getState();
  const n = state.nextUntitled();
  const id = `untitled:${n}`;
  state.addDoc({
    id,
    path: null,
    name: n === 1 ? "Untitled" : `Untitled ${n}`,
    text: initialText,
    savedText: initialText,
    lineEnding: state.platform === "windows" ? "crlf" : "lf",
    diskModified: 0,
  });
  return id;
}

export async function openFileDialog() {
  const picked = await openDialog({
    multiple: true,
    directory: false,
    filters: MARKDOWN_FILTER,
  });
  if (!picked) return;
  const paths = Array.isArray(picked) ? picked : [picked];
  for (const p of paths) await openPath(p);
}

export async function openFolderDialog() {
  const picked = await openDialog({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  const state = useStore.getState();
  state.setFolder(picked);
  state.patchSettings({ sidebarVisible: true, sidebarTab: "files" });
}

// --- saving ----------------------------------------------------------------

export async function saveDoc(id: string, opts: { saveAs?: boolean } = {}): Promise<boolean> {
  const state = useStore.getState();
  const doc = state.docs.find((d) => d.id === id);
  if (!doc) return false;

  let target = doc.path;
  if (!target || opts.saveAs) {
    const suggestedName = doc.path ? basename(doc.path) : `${doc.name}.md`;
    const defaultDir = doc.path ? dirname(doc.path) : (state.folder ?? state.home);
    const picked = await saveDialog({
      defaultPath: defaultDir ? `${defaultDir}/${suggestedName}` : suggestedName,
      filters: MARKDOWN_FILTER,
    });
    if (!picked) return false;
    target = extname(picked) ? picked : `${picked}.md`;
  }

  try {
    const modified = await ipc.writeDocument(target, doc.text, doc.lineEnding);
    useStore.getState().markSaved(id, target, modified);
    useStore.getState().noteRecentFile(target);
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

export async function saveActive(opts: { saveAs?: boolean } = {}) {
  const id = useStore.getState().activeId;
  if (!id) return false;
  return saveDoc(id, opts);
}

/** Saves every dirty document that already lives on disk. Used by auto-save. */
export async function saveDirtyToDisk() {
  for (const doc of useStore.getState().docs) {
    if (doc.path && doc.text !== doc.savedText) await saveDoc(doc.id);
  }
}

export async function saveAll() {
  const { docs } = useStore.getState();
  for (const doc of docs) {
    if (doc.text !== doc.savedText) await saveDoc(doc.id);
  }
}

// --- closing ---------------------------------------------------------------

/** Returns false when the user cancelled. */
export async function closeTab(id: string): Promise<boolean> {
  const state = useStore.getState();
  const doc = state.docs.find((d) => d.id === id);
  if (!doc) return true;

  if (doc.text !== doc.savedText) {
    const answer = await confirmDialog({
      title: `Save changes to "${doc.name}"?`,
      message: "Your changes will be lost if you don't save them.",
      choices: [
        { id: "save", label: "Save", tone: "primary" },
        { id: "discard", label: "Don't Save", tone: "quiet" },
        { id: "cancel", label: "Cancel", tone: "quiet" },
      ],
    });
    if (answer === "cancel") return false;
    if (answer === "save") {
      const saved = await saveDoc(id);
      if (!saved) return false;
    }
  }

  useStore.getState().closeDoc(id);
  return true;
}

export async function requestAppClose(): Promise<void> {
  const state = useStore.getState();
  const dirty = state.docs.filter((d) => d.text !== d.savedText);

  if (dirty.length) {
    const answer = await confirmDialog({
      title:
        dirty.length === 1
          ? `Save changes to "${dirty[0].name}"?`
          : `Save changes to ${dirty.length} documents?`,
      message: "Your changes will be lost if you don't save them.",
      choices: [
        { id: "save", label: dirty.length > 1 ? "Save All" : "Save", tone: "primary" },
        { id: "discard", label: "Don't Save", tone: "quiet" },
        { id: "cancel", label: "Cancel", tone: "quiet" },
      ],
    });
    if (answer === "cancel") return;
    if (answer === "save") {
      for (const doc of dirty) {
        const ok = await saveDoc(doc.id);
        if (!ok) return;
      }
    }
  }

  await persistPrefs(true);
  await ipc.confirmClose();
}

// --- file tree operations ---------------------------------------------------

export async function createFileIn(dir: string) {
  try {
    const path = await ipc.createDocumentFile(dir, "Untitled.md");
    await openPath(path);
    return path;
  } catch (error) {
    fail(error);
    return null;
  }
}

export async function createFolderIn(dir: string) {
  try {
    return await ipc.createFolderEntry(dir, "New Folder");
  } catch (error) {
    fail(error);
    return null;
  }
}

export async function renamePath(path: string, newName: string) {
  try {
    const next = await ipc.renameEntry(path, newName);
    const state = useStore.getState();
    const doc = state.docs.find((d) => d.path === path);
    if (doc) {
      state.replaceDoc(doc.id, { id: next, path: next, name: basename(next) });
      if (state.activeId === doc.id) state.setActive(next);
    }
    return next;
  } catch (error) {
    fail(error);
    return null;
  }
}

export async function deletePath(path: string) {
  const answer = await confirmDialog({
    title: `Move "${basename(path)}" to the trash?`,
    message: "You can restore it from your system trash.",
    choices: [
      { id: "delete", label: "Move to Trash", tone: "danger" },
      { id: "cancel", label: "Cancel", tone: "quiet" },
    ],
  });
  if (answer !== "delete") return false;

  try {
    await ipc.trashEntry(path);
    const state = useStore.getState();
    const doc = state.docs.find((d) => d.path === path);
    if (doc) state.closeDoc(doc.id);
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

// --- external changes -------------------------------------------------------

let checking = false;

/** Re-reads open files whose mtime moved while we were not looking. */
export async function checkDiskChanges() {
  if (checking) return;
  checking = true;
  try {
    const { docs } = useStore.getState();
    for (const doc of docs) {
      if (!doc.path) continue;
      const mtime = await ipc.fileMtime(doc.path);
      if (mtime == null || mtime === doc.diskModified) continue;

      const dirty = doc.text !== doc.savedText;
      if (dirty) {
        const answer = await confirmDialog({
          title: `"${doc.name}" changed on disk`,
          message: "You have unsaved edits here. Which version should win?",
          choices: [
            { id: "reload", label: "Reload from Disk", tone: "danger" },
            { id: "keep", label: "Keep My Edits", tone: "primary" },
          ],
        });
        if (answer !== "reload") {
          useStore.getState().replaceDoc(doc.id, { diskModified: mtime });
          continue;
        }
      }

      try {
        const fresh = await ipc.readDocument(doc.path);
        useStore.getState().replaceDoc(doc.id, {
          text: fresh.content,
          savedText: fresh.content,
          diskModified: fresh.modified,
          lineEnding: fresh.lineEnding,
          revision: (useStore.getState().docs.find((d) => d.id === doc.id)?.revision ?? 0) + 1,
        });
      } catch {
        // File vanished; leave the buffer alone so the user can re-save it.
      }
    }
  } finally {
    checking = false;
  }
}

// --- links ------------------------------------------------------------------

export async function followLink(href: string, fromDoc: OpenDoc | null) {
  if (/^(https?:|mailto:)/i.test(href)) {
    try {
      await openUrl(href);
    } catch (error) {
      fail(error);
    }
    return;
  }
  if (href.startsWith("#")) return;

  const { join, isAbsolute } = await import("../lib/path");
  const base = fromDoc?.path ? dirname(fromDoc.path) : useStore.getState().folder;
  let target = decodeURIComponent(href.split("#")[0]);
  if (!isAbsolute(target)) {
    if (!base) return;
    target = join(base, target);
  }

  if (await ipc.pathExists(target)) {
    await openPath(target);
  } else if (await ipc.pathExists(`${target}.md`)) {
    await openPath(`${target}.md`);
  } else {
    useStore.getState().pushToast(`Nothing found at ${basename(target)}`, "error");
  }
}

// --- export -----------------------------------------------------------------

export async function exportHtml(html: string, docName: string) {
  const state = useStore.getState();
  const doc = state.activeDoc();
  const defaultDir = doc?.path ? dirname(doc.path) : (state.folder ?? state.home);
  const suggested = `${stem(docName)}.html`;

  const picked = await saveDialog({
    defaultPath: defaultDir ? `${defaultDir}/${suggested}` : suggested,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!picked) return;

  try {
    await ipc.writeDocument(picked, html, "lf");
    state.pushToast(`Exported to ${basename(picked)}`);
  } catch (error) {
    fail(error);
  }
}

export async function exportMarkdownCopy() {
  const doc = useStore.getState().activeDoc();
  if (!doc) return;
  await saveDoc(doc.id, { saveAs: true });
}

// --- preferences ------------------------------------------------------------

let persistTimer: number | undefined;

export function schedulePersist() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => void persistPrefs(), 600);
}

export async function persistPrefs(immediate = false) {
  if (immediate) window.clearTimeout(persistTimer);
  const state = useStore.getState();
  try {
    await ipc.savePrefs({
      settings: state.settings,
      folder: state.folder,
      recentFolders: state.recentFolders,
      recentFiles: state.recentFiles,
      openFiles: state.docs.map((d) => d.path).filter((p): p is string => !!p),
      activeFile: state.activeDoc()?.path ?? null,
    });
  } catch {
    // Preferences are a convenience; never let them break the session.
  }
}

const WELCOME = `# Welcome to Lumen

Lumen is a **live-preview** Markdown editor: the syntax disappears as soon as
you move the caret away, so you read a finished document while you write one.

## Try it

- Put the caret on this heading — the \`##\` reappears
- Select a word and press \`Ctrl\`+\`B\` to make it **bold**
- Type \`- [ ] \` to start a task list

- [x] Live preview that gets out of the way
- [ ] Files sidebar and document outline
- [ ] Command palette on Ctrl+Shift+P

## Everything you'd expect

| Feature | Shortcut |
| --- | --- |
| Bold | Ctrl+B |
| Italic | Ctrl+I |
| Inline code | Ctrl+E |
| Source mode | Ctrl+/ |

> Blockquotes, footnotes, tables, math and code all render inline.

\`\`\`python
def greet(name: str) -> str:
    return f"Hello, {name}"
\`\`\`

Inline math like $e^{i\\pi} + 1 = 0$ renders as you type, and display math
gets its own block:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

---

Open a folder with **Ctrl+Shift+O** to browse your notes.
`;

export async function bootstrap() {
  const store = useStore.getState();

  try {
    const info = await ipc.getStartupInfo();
    store.setEnvironment({ home: info.home, platform: info.platform });
    document.documentElement.dataset.platform = info.platform;

    const prefs = (await ipc.loadPrefs()) as {
      settings?: Record<string, unknown>;
      folder?: string | null;
      recentFolders?: string[];
      recentFiles?: string[];
      openFiles?: string[];
      activeFile?: string | null;
    };

    store.hydrate({
      settings: prefs.settings as never,
      folder: prefs.folder ?? null,
      recentFolders: prefs.recentFolders ?? [],
      recentFiles: prefs.recentFiles ?? [],
    });

    let opened = 0;
    for (const path of info.files) {
      if (await openPath(path)) opened++;
    }

    if (!opened) {
      for (const path of prefs.openFiles ?? []) {
        if (await ipc.pathExists(path)) {
          await openPath(path);
          opened++;
        }
      }
      if (prefs.activeFile) {
        const match = useStore.getState().docs.find((d) => d.path === prefs.activeFile);
        if (match) useStore.getState().setActive(match.id);
      }
    }

    if (!opened) newDocument(WELCOME);
  } catch (error) {
    fail(error);
    if (!useStore.getState().docs.length) newDocument(WELCOME);
  } finally {
    await ipc.signalReady();
  }
}
