import { redo, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMemo } from "react";
import { insertImage, runEditorAction } from "../editor/commands";
import { dirname, relative } from "../lib/path";
import { DARK_THEMES, LIGHT_THEMES, pickTheme, THEMES } from "../lib/themes";
import * as actions from "./actions";
import { useStore, type Settings } from "./store";

export interface AppCommand {
  id: string;
  label: string;
  group: string;
  keys?: string;
  run: () => void | Promise<void>;
  /** Shown as a checkmark in menus for toggles. */
  checked?: boolean;
}

export interface MenuSection {
  label: string;
  items: Array<string | "-">;
}

export const MENU_MODEL: MenuSection[] = [
  {
    label: "File",
    items: [
      "new",
      "open",
      "open-folder",
      "-",
      "save",
      "save-as",
      "-",
      "export-html",
      "export-pdf",
      "-",
      "reveal",
      "close-tab",
    ],
  },
  {
    label: "Edit",
    items: ["undo", "redo", "-", "find", "replace", "-", "palette", "quick-open"],
  },
  {
    label: "Format",
    items: [
      "bold",
      "italic",
      "strike",
      "inline-code",
      "highlight",
      "-",
      "h1",
      "h2",
      "h3",
      "paragraph",
      "-",
      "link",
      "image",
      "table",
      "code-block",
      "quote",
      "hr",
      "-",
      "list-bullet",
      "list-ordered",
      "list-task",
    ],
  },
  {
    label: "View",
    items: [
      "toggle-sidebar",
      "toggle-outline",
      "-",
      "toggle-source",
      "toggle-focus",
      "toggle-typewriter",
      "-",
      "theme-toggle",
      "theme-next",
      "settings",
      "-",
      "zoom-in",
      "zoom-out",
      "zoom-reset",
      "-",
      "toggle-fullscreen",
    ],
  },
  { label: "Help", items: ["shortcuts", "markdown-guide"] },
];

const isMac = () => document.documentElement.dataset.platform === "macos";

/** Renders `Mod+Shift+P` using the right glyphs for the platform. */
export function prettyKeys(keys: string): string {
  const mac = isMac();
  return keys
    .split("+")
    .map((part) => {
      switch (part) {
        case "Mod":
          return mac ? "⌘" : "Ctrl";
        case "Shift":
          return mac ? "⇧" : "Shift";
        case "Alt":
          return mac ? "⌥" : "Alt";
        default:
          return part;
      }
    })
    .join(mac ? "" : "+");
}

interface CommandContext {
  getView: () => EditorView | null;
  requestPrint: () => void;
  requestExportHtml: () => void;
}

export function useAppCommands(ctx: CommandContext): AppCommand[] {
  const settings = useStore((s) => s.settings);
  const activeId = useStore((s) => s.activeId);
  const docs = useStore((s) => s.docs);

  return useMemo(() => {
    const activeDoc = docs.find((d) => d.id === activeId) ?? null;

    const set = (patch: Partial<Settings>) => {
      useStore.getState().patchSettings(patch);
      actions.schedulePersist();
    };

    const editor = (id: string, label: string, keys?: string): AppCommand => ({
      id,
      label,
      group: "Format",
      keys,
      run: () => {
        runEditorAction(ctx.getView(), id);
      },
    });

    const list: AppCommand[] = [
      // --- File ---
      {
        id: "new",
        label: "New Document",
        group: "File",
        keys: "Mod+N",
        run: () => {
          actions.newDocument();
        },
      },
      { id: "open", label: "Open File…", group: "File", keys: "Mod+O", run: actions.openFileDialog },
      {
        id: "open-folder",
        label: "Open Folder…",
        group: "File",
        keys: "Mod+Shift+O",
        run: actions.openFolderDialog,
      },
      {
        id: "save",
        label: "Save",
        group: "File",
        keys: "Mod+S",
        run: async () => {
          await actions.saveActive();
        },
      },
      {
        id: "save-as",
        label: "Save As…",
        group: "File",
        keys: "Mod+Shift+S",
        run: async () => {
          await actions.saveActive({ saveAs: true });
        },
      },
      { id: "save-all", label: "Save All", group: "File", run: actions.saveAll },
      {
        id: "export-html",
        label: "Export as HTML…",
        group: "File",
        run: ctx.requestExportHtml,
      },
      {
        id: "export-pdf",
        label: "Print / Export PDF…",
        group: "File",
        keys: "Mod+P",
        run: ctx.requestPrint,
      },
      {
        id: "reveal",
        label: isMac() ? "Reveal in Finder" : "Show in File Manager",
        group: "File",
        run: () => {
          const path = activeDoc?.path;
          if (path) void import("../lib/ipc").then((m) => m.revealEntry(path));
        },
      },
      {
        id: "close-tab",
        label: "Close Tab",
        group: "File",
        keys: "Mod+W",
        run: () => {
          if (activeId) void actions.closeTab(activeId);
        },
      },

      // --- Edit ---
      {
        id: "undo",
        label: "Undo",
        group: "Edit",
        keys: "Mod+Z",
        run: () => {
          const view = ctx.getView();
          if (view) {
            undo(view);
            view.focus();
          }
        },
      },
      {
        id: "redo",
        label: "Redo",
        group: "Edit",
        keys: "Mod+Shift+Z",
        run: () => {
          const view = ctx.getView();
          if (view) {
            redo(view);
            view.focus();
          }
        },
      },
      {
        id: "find",
        label: "Find…",
        group: "Edit",
        keys: "Mod+F",
        run: () => {
          const view = ctx.getView();
          if (view) {
            openSearchPanel(view);
          }
        },
      },
      {
        id: "replace",
        label: "Find and Replace…",
        group: "Edit",
        keys: "Mod+Alt+F",
        run: () => {
          const view = ctx.getView();
          if (view) {
            openSearchPanel(view);
            requestAnimationFrame(() => {
              const toggle = view.dom.querySelector<HTMLInputElement>(
                '.cm-search input[name="replace"], .cm-search [name="replace"]',
              );
              toggle?.focus();
            });
          }
        },
      },
      {
        id: "palette",
        label: "Command Palette…",
        group: "Edit",
        keys: "Mod+Shift+P",
        run: () => useStore.getState().setPalette(true),
      },
      {
        id: "quick-open",
        label: "Quick Open…",
        group: "Edit",
        keys: "Mod+K",
        run: () => useStore.getState().setQuickOpen(true),
      },

      // --- Format ---
      editor("bold", "Bold", "Mod+B"),
      editor("italic", "Italic", "Mod+I"),
      editor("strike", "Strikethrough", "Mod+Shift+X"),
      editor("inline-code", "Inline Code", "Mod+E"),
      editor("highlight", "Highlight", "Mod+Shift+H"),
      editor("h1", "Heading 1", "Mod+1"),
      editor("h2", "Heading 2", "Mod+2"),
      editor("h3", "Heading 3", "Mod+3"),
      editor("h4", "Heading 4", "Mod+4"),
      editor("h5", "Heading 5", "Mod+5"),
      editor("h6", "Heading 6", "Mod+6"),
      editor("paragraph", "Paragraph", "Mod+0"),
      editor("link", "Insert Link", "Mod+L"),
      editor("table", "Insert Table", "Mod+Shift+T"),
      editor("code-block", "Code Block", "Mod+Shift+K"),
      editor("quote", "Blockquote", "Mod+Shift+Q"),
      editor("hr", "Horizontal Rule", "Mod+Shift+R"),
      editor("list-bullet", "Bulleted List", "Mod+Shift+8"),
      editor("list-ordered", "Numbered List", "Mod+Shift+9"),
      editor("list-task", "Task List", "Mod+Shift+0"),
      {
        id: "image",
        label: "Insert Image…",
        group: "Format",
        run: async () => {
          const picked = await openDialog({
            multiple: false,
            filters: [
              { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp", "avif"] },
            ],
          });
          if (typeof picked !== "string") return;
          const view = ctx.getView();
          if (!view) return;
          const base = activeDoc?.path ? dirname(activeDoc.path) : null;
          const href = base ? relative(base, picked) : picked;
          insertImage(href.replace(/ /g, "%20"))(view);
        },
      },

      // --- View ---
      {
        id: "toggle-sidebar",
        label: "Toggle Sidebar",
        group: "View",
        keys: "Mod+\\",
        checked: settings.sidebarVisible,
        run: () => set({ sidebarVisible: !settings.sidebarVisible }),
      },
      {
        id: "toggle-outline",
        label: "Outline",
        group: "View",
        keys: "Mod+Shift+\\",
        checked: settings.sidebarVisible && settings.sidebarTab === "outline",
        run: () =>
          set(
            settings.sidebarVisible && settings.sidebarTab === "outline"
              ? { sidebarVisible: false }
              : { sidebarVisible: true, sidebarTab: "outline" },
          ),
      },
      {
        id: "toggle-source",
        label: "Source Mode",
        group: "View",
        keys: "Mod+/",
        checked: settings.sourceMode,
        run: () => set({ sourceMode: !settings.sourceMode }),
      },
      {
        id: "toggle-focus",
        label: "Focus Mode",
        group: "View",
        keys: "Mod+Shift+F",
        checked: settings.focusMode,
        run: () => set({ focusMode: !settings.focusMode }),
      },
      {
        id: "toggle-typewriter",
        label: "Typewriter Mode",
        group: "View",
        checked: settings.typewriter,
        run: () => set({ typewriter: !settings.typewriter }),
      },
      {
        id: "theme-toggle",
        label: "Toggle Dark Mode",
        group: "View",
        keys: "Mod+Shift+D",
        run: () => {
          const dark = document.documentElement.dataset.theme === "dark";
          set({ theme: dark ? "light" : "dark" });
        },
      },
      {
        id: "theme-next",
        label: "Next Theme",
        group: "View",
        run: () => {
          const dark = document.documentElement.dataset.theme === "dark";
          const list = dark ? DARK_THEMES : LIGHT_THEMES;
          const currentId = dark ? settings.darkPalette : settings.lightPalette;
          const next = list[(list.findIndex((t) => t.id === currentId) + 1) % list.length];
          set(pickTheme(next, settings.theme));
          useStore.getState().pushToast(`Theme: ${next.label}`);
        },
      },
      ...THEMES.map((theme) => ({
        id: `theme:${theme.id}`,
        label: `Theme: ${theme.label} ${theme.mode === "dark" ? "(Dark)" : "(Light)"}`,
        group: "View",
        checked:
          (theme.mode === "light" ? settings.lightPalette : settings.darkPalette) === theme.id,
        run: () => set(pickTheme(theme, settings.theme)),
      })),
      {
        id: "settings",
        label: "Settings…",
        group: "View",
        keys: "Mod+,",
        run: () => useStore.getState().setSettingsOpen(true),
      },
      {
        id: "zoom-in",
        label: "Zoom In",
        group: "View",
        keys: "Mod+=",
        run: () => set({ fontSize: Math.min(28, settings.fontSize + 1) }),
      },
      {
        id: "zoom-out",
        label: "Zoom Out",
        group: "View",
        keys: "Mod+-",
        run: () => set({ fontSize: Math.max(12, settings.fontSize - 1) }),
      },
      {
        id: "zoom-reset",
        label: "Actual Size",
        group: "View",
        keys: "Mod+Shift+=",
        run: () => set({ fontSize: 17 }),
      },
      {
        id: "toggle-fullscreen",
        label: "Full Screen",
        group: "View",
        keys: "F11",
        run: async () => {
          const win = getCurrentWindow();
          await win.setFullscreen(!(await win.isFullscreen()));
        },
      },
      {
        id: "toggle-file-filter",
        label: settings.showAllFiles ? "Show Only Markdown Files" : "Show All Files",
        group: "View",
        run: () => set({ showAllFiles: !settings.showAllFiles }),
      },

      // --- Help ---
      {
        id: "shortcuts",
        label: "Keyboard Shortcuts",
        group: "Help",
        run: () => useStore.getState().setShortcutsOpen(true),
      },
      {
        id: "markdown-guide",
        label: "Markdown Reference",
        group: "Help",
        run: () => {
          actions.newDocument(MARKDOWN_GUIDE);
        },
      },
    ];

    return list;
  }, [ctx, settings, activeId, docs]);
}

const MARKDOWN_GUIDE = `# Markdown Reference

## Text

| Markdown | Result |
| --- | --- |
| \`**bold**\` | **bold** |
| \`*italic*\` | *italic* |
| \`~~strike~~\` | ~~strike~~ |
| \`\\\`code\\\`\` | \`code\` |
| \`==mark==\` | ==mark== |

## Headings

\`\`\`markdown
# Heading 1
## Heading 2
### Heading 3
\`\`\`

## Lists

\`\`\`markdown
- Bulleted item
1. Numbered item
- [ ] Task to do
- [x] Task done
\`\`\`

## Links and images

\`\`\`markdown
[Link text](https://example.com)
![Alt text](./picture.png)
\`\`\`

Relative image paths resolve against the folder of the current document.

## Code

Fence a block with three backticks and name the language for highlighting:

\`\`\`markdown
\\\`\\\`\\\`rust
fn main() { println!("hi"); }
\\\`\\\`\\\`
\`\`\`

## Tables

\`\`\`markdown
| Left | Center | Right |
| :--- | :----: | ----: |
| a | b | c |
\`\`\`

## Math

Inline math uses single dollars, display math uses double dollars on their
own lines.

$$
a^2 + b^2 = c^2
$$

## Other blocks

\`\`\`markdown
> A blockquote

---

<!-- an HTML comment -->
\`\`\`
`;
