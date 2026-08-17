import { create } from "zustand";
import { basename } from "../lib/path";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "../lib/themes";

export type ThemeChoice = "light" | "dark" | "system";
export type SidebarTab = "files" | "outline" | "search";
export type TypeFace = "serif" | "sans" | "mono";
export type ContentWidth = "narrow" | "normal" | "wide";

export interface OpenDoc {
  /** Stable identity: the file path, or `untitled:n` before the first save. */
  id: string;
  path: string | null;
  name: string;
  text: string;
  /** Text as it exists on disk; drives the dirty indicator. */
  savedText: string;
  lineEnding: "lf" | "crlf";
  diskModified: number;
  /** Bumped when the buffer must be reloaded from `text`. */
  revision: number;
}

export interface Settings {
  /** Light, dark, or follow the OS. */
  theme: ThemeChoice;
  /** Which named palette to use in each mode. */
  lightPalette: string;
  darkPalette: string;
  sourceMode: boolean;
  focusMode: boolean;
  typewriter: boolean;
  spellcheck: boolean;
  sidebarVisible: boolean;
  sidebarTab: SidebarTab;
  sidebarWidth: number;
  fontSize: number;
  typeface: TypeFace;
  contentWidth: ContentWidth;
  showAllFiles: boolean;
}

export const defaultSettings: Settings = {
  theme: "system",
  lightPalette: DEFAULT_LIGHT_THEME,
  darkPalette: DEFAULT_DARK_THEME,
  sourceMode: false,
  focusMode: false,
  typewriter: false,
  spellcheck: true,
  sidebarVisible: true,
  sidebarTab: "files",
  sidebarWidth: 264,
  fontSize: 17,
  typeface: "serif",
  contentWidth: "normal",
  showAllFiles: false,
};

export interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
}

interface AppState {
  docs: OpenDoc[];
  activeId: string | null;
  folder: string | null;
  recentFolders: string[];
  home: string;
  platform: string;
  settings: Settings;
  toasts: Toast[];
  paletteOpen: boolean;
  quickOpen: boolean;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  untitledCounter: number;

  activeDoc: () => OpenDoc | null;
  isDirty: (id: string) => boolean;
  hasUnsaved: () => boolean;

  addDoc: (doc: Omit<OpenDoc, "revision">) => void;
  replaceDoc: (id: string, patch: Partial<OpenDoc>) => void;
  closeDoc: (id: string) => void;
  setActive: (id: string | null) => void;
  reorderDocs: (from: number, to: number) => void;
  setText: (id: string, text: string) => void;
  markSaved: (id: string, path: string, modified: number) => void;

  setFolder: (folder: string | null) => void;
  setEnvironment: (env: { home: string; platform: string }) => void;
  patchSettings: (patch: Partial<Settings>) => void;
  hydrate: (state: {
    settings?: Partial<Settings>;
    folder?: string | null;
    recentFolders?: string[];
  }) => void;

  pushToast: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;

  setPalette: (open: boolean) => void;
  setQuickOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  nextUntitled: () => number;
}

let toastSeq = 0;

export const useStore = create<AppState>((set, get) => ({
  docs: [],
  activeId: null,
  folder: null,
  recentFolders: [],
  home: "",
  platform: "windows",
  settings: defaultSettings,
  toasts: [],
  paletteOpen: false,
  quickOpen: false,
  settingsOpen: false,
  shortcutsOpen: false,
  untitledCounter: 0,

  activeDoc: () => {
    const { docs, activeId } = get();
    return docs.find((d) => d.id === activeId) ?? null;
  },

  isDirty: (id) => {
    const doc = get().docs.find((d) => d.id === id);
    return !!doc && doc.text !== doc.savedText;
  },

  hasUnsaved: () => get().docs.some((d) => d.text !== d.savedText),

  addDoc: (doc) =>
    set((state) => {
      const existing = state.docs.find((d) => d.id === doc.id);
      if (existing) return { activeId: doc.id };
      return { docs: [...state.docs, { ...doc, revision: 0 }], activeId: doc.id };
    }),

  replaceDoc: (id, patch) =>
    set((state) => ({
      docs: state.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })),

  closeDoc: (id) =>
    set((state) => {
      const index = state.docs.findIndex((d) => d.id === id);
      if (index < 0) return {};
      const docs = state.docs.filter((d) => d.id !== id);
      let activeId = state.activeId;
      if (activeId === id) {
        const next = docs[index] ?? docs[index - 1] ?? null;
        activeId = next ? next.id : null;
      }
      return { docs, activeId };
    }),

  setActive: (id) => set({ activeId: id }),

  reorderDocs: (from, to) =>
    set((state) => {
      const docs = [...state.docs];
      const [moved] = docs.splice(from, 1);
      if (!moved) return {};
      docs.splice(to, 0, moved);
      return { docs };
    }),

  setText: (id, text) =>
    set((state) => ({
      docs: state.docs.map((d) => (d.id === id ? { ...d, text } : d)),
    })),

  markSaved: (id, path, modified) =>
    set((state) => ({
      docs: state.docs.map((d) =>
        d.id === id
          ? {
              ...d,
              id: path,
              path,
              name: basename(path),
              savedText: d.text,
              diskModified: modified,
            }
          : d,
      ),
      activeId: state.activeId === id ? path : state.activeId,
    })),

  setFolder: (folder) =>
    set((state) => ({
      folder,
      recentFolders: folder
        ? [folder, ...state.recentFolders.filter((f) => f !== folder)].slice(0, 8)
        : state.recentFolders,
    })),

  setEnvironment: (env) => set(env),

  patchSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } })),

  hydrate: (incoming) =>
    set((state) => ({
      settings: { ...state.settings, ...(incoming.settings ?? {}) },
      folder: incoming.folder ?? state.folder,
      recentFolders: incoming.recentFolders ?? state.recentFolders,
    })),

  pushToast: (message, tone = "info") =>
    set((state) => ({
      toasts: [...state.toasts, { id: ++toastSeq, message, tone }].slice(-4),
    })),

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  setPalette: (open) => set({ paletteOpen: open, quickOpen: open ? false : get().quickOpen }),
  setQuickOpen: (open) => set({ quickOpen: open, paletteOpen: open ? false : get().paletteOpen }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

  nextUntitled: () => {
    const n = get().untitledCounter + 1;
    set({ untitledCounter: n });
    return n;
  },
}));
