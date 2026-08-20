# Onionskin

A clean, modern Markdown editor built with **Tauri 2**, React and CodeMirror 6.

Onionskin mimics Typora's defining idea: there is no split pane and no preview
button. You type Markdown and it becomes the formatted document underneath your
caret. Move away from a heading and the `##` melts off; move back and it
returns, ready to edit.

## Features

**Seamless live preview**

- Headings, bold, italic, strikethrough, `inline code`, ==highlight==, and links
  render in place; syntax markers reappear only on the line or span you are editing
- Tables render as real tables — click any row to drop the caret on its source line
- Images render inline, resolved relative to the document's own folder
- Fenced code blocks become rounded cards with a language chip and syntax
  highlighting for 100+ languages
- Task lists get clickable checkboxes; bullets, blockquotes and rules are styled
- LaTeX math via KaTeX, both inline (`$…$`) and display (`$$…$$`)
- YAML front matter collapses to a compact chip
- **Source mode** (`Ctrl+/`) turns all of it off when you want the raw text

**Context menus**

The webview's own menu is replaced everywhere with menus that know what you
right-clicked:

- **Text** — cut/copy/paste (operating on the whole line when nothing is
  selected), *Paste Special* as a code block, blockquote, link or plain text,
  and submenus for Format, Heading, List, Insert and Line operations
- **Table** — insert or delete rows and columns, move rows, set column
  alignment, delete the table. Edits re-align the pipes, Typora style
- **Link** — open, copy address, edit address, remove the link
- **Image** — open, copy path, reveal in the file manager, replace
- **Code block** — copy the block's contents without the fences
- **Task** — mark complete or incomplete
- **Tabs** — save, close others/saved/all, copy path, reveal
- **File tree** — new file or folder, rename, copy path, reveal, move to trash
- Whole document — copy as HTML or as plain text, copy file path

Hold <kbd>Shift</kbd> while right-clicking to get the webview's native menu
instead, which is where spelling suggestions live.

**Workspace**

- Tabs with dirty indicators, drag-to-reorder, and per-tab undo history
- Sidebar with a lazy file tree (create / rename / move-to-trash / reveal),
  a live document outline, and full-text search across the folder
- Command palette (`Ctrl+Shift+P`) and quick file open (`Ctrl+K`), which lists
  open tabs, then recently opened files, then everything in the folder
- Focus mode, typewriter mode, adjustable text size, line width and typeface

**Themes**

Eleven built-in themes, five light and six dark:

| Light | Dark |
| --- | --- |
| Onionskin, Paper, GitHub, Solarized, Snow | Carbon, Midnight, Nord, Dracula, Gruvbox, Solarized |

Each theme restyles the whole app — chrome, editor, code syntax colours and
highlight marks. Pick one per mode in **Settings → Appearance**; the Mode
control (Light / Dark / System) decides which of the two is showing, so
following the OS still gets you your own choice of light and dark theme.
`Ctrl+Shift+D` flips modes and every theme is reachable from the command
palette (`Theme: Nord`), plus **Next Theme** to cycle.

Every theme is checked against WCAG AA: body and secondary text clear 4.5:1
and the caret clears the 3:1 threshold for UI elements on all of them.

**Files**

- Deletes go to the system trash, never straight to `/dev/null`
- Windows line endings are detected on open and restored on save
- External edits are detected when the window regains focus, with a
  keep-mine / reload prompt when the buffer is dirty
- Auto-save 1.5s after you stop typing (and when the window loses focus) for
  files that already exist on disk; new documents still prompt. Toggle in
  Settings → Writing
- Auto-update: checks after launch, asks before installing, and flushes
  unsaved work first because the installer closes the app
- Session (open files, folder, recent files, settings) is restored on next launch
- Export to a self-contained HTML file, or print / save as PDF

## Requirements

- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs) 1.77+
- Platform prerequisites listed in the
  [Tauri setup guide](https://tauri.app/start/prerequisites/) — on Windows that
  is the MSVC build tools and WebView2 (bundled with Windows 11).

## Running

```bash
npm install
```

```bash
npm run app
```

`npm run app` starts the Vite dev server and the Tauri shell together with hot
reload. To produce installers for the current platform:

```bash
npm run app:build
```

Artifacts land in `src-tauri/target/release/bundle/` — `.msi` and `.exe` on
Windows, `.dmg` and `.app` on macOS, `.deb`/`.rpm`/`.AppImage` on Linux.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Frontend only, in a normal browser (no file access) |
| `npm run build` | Typecheck and build the frontend bundle |

## Releasing

Onionskin updates itself. The app checks for a new version shortly after
launch, and never installs anything without asking.

Updates are signed with a keypair that is **not** the same thing as a code
signing certificate. The public half lives in `src-tauri/tauri.conf.json`; the
private half must stay off the repository. Losing it means existing installs
can never accept another update, so back it up somewhere durable.

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.onionskin/updater.key)"
npm run app:build
npm run release
```

Tauri reads the key *contents* from that variable. The `TAURI_SIGNING_PRIVATE_KEY_PATH`
variant is not honoured by the bundler, and the build will quietly produce
installers with no signatures — which the updater then refuses.

`npm run release` writes `dist-release/latest.json` and prints the
`gh release create` command. The updater fetches:

```
https://github.com/infonality/onionskin/releases/latest/download/latest.json
```

Two consequences worth knowing:

- **A published release has to exist.** That URL resolves to the newest
  release's attached `latest.json`. With no release yet — or on a private
  repository — it returns 404 and every check fails silently.
- **Bump the version in both `package.json` and `src-tauri/tauri.conf.json`.**
  `npm run release` refuses to run if they disagree, because a manifest whose
  version matches the installed one would leave clients in a loop.

Windows updates install through the NSIS installer rather than the MSI: it can
replace a running installation without the MSI's elevation dance. The MSI is
still built, for first-time installs.

## Keyboard shortcuts

`Ctrl` is `Cmd` on macOS. The full list lives under **Help → Keyboard Shortcuts**.

| | |
| --- | --- |
| `Ctrl+N` / `Ctrl+O` / `Ctrl+Shift+O` | New / open file / open folder |
| `Ctrl+S` / `Ctrl+Shift+S` | Save / save as |
| `Ctrl+Shift+P` / `Ctrl+K` | Command palette / quick open |
| `Ctrl+F` / `Ctrl+Alt+F` | Find / find and replace |
| `Ctrl+B` `Ctrl+I` `Ctrl+E` `Ctrl+L` | Bold, italic, inline code, link |
| `Ctrl+Shift+V` | Paste as plain text |
| `Ctrl+1`…`6` / `Ctrl+0` | Heading level / paragraph |
| `Ctrl+Shift+8/9/0` | Bulleted / numbered / task list |
| `Ctrl+/` | Source mode |
| `Ctrl+\` | Toggle sidebar |
| `Ctrl+Shift+D` | Toggle dark mode |
| `Ctrl+P` | Print / export PDF |

## How it is put together

```
src/
  editor/
    livePreview.ts   Decoration engine: hides syntax, styles blocks, swaps in widgets
    widgets.ts       Table, image, math, checkbox, rule and front-matter widgets
    commands.ts      Markdown formatting commands and list/quote continuation
    modes.ts         Focus mode and typewriter scrolling
    Editor.tsx       CodeMirror lifecycle, per-tab state caching
    contextMenu.ts   Context-sensitive right-click menu for the editor
    tableEdit.ts     Locating the table under the caret and rewriting it
  components/        Title bar, tabs, sidebar, palette, status bar, sheets
    ContextMenu.tsx  Menu host with flyout submenus and keyboard navigation
  state/             Zustand store, file actions, command registry
  lib/               IPC wrappers, path helpers, markdown rendering, HTML export
    table.ts         Pure GFM table model: parse, re-align, insert, delete
    themes.ts        Theme registry and preview swatches
  styles/
    base.css         Design tokens plus the light and dark bases
    themes.css       Named palettes layered over those bases
src-tauri/src/
  fs_ops.rs          File read/write, directory listing, search, trash, reveal
  prefs.rs           Preference persistence
  menu.rs            Native macOS menu bar
  lib.rs             Command registration and window lifecycle
```

The live-preview engine is split in two on purpose. Block-level replacements
(tables, rules, display math, front matter, HTML blocks) span line breaks, which
CodeMirror only permits from a `StateField`, so they live in `blockField`.
Everything inline is a viewport-scoped `ViewPlugin`, which keeps typing fast in
long documents. Both consult the same "is the caret in here?" test, and the
inline pass skips any range the block pass already claimed so replacements can
never partially overlap.

Window chrome is custom on Windows and Linux (`decorations: false` plus an
in-app menu); macOS keeps its native traffic lights and a real menu bar via
`tauri.macos.conf.json`.

## Notes

- The asset protocol is scoped to `**` so documents can display images from
  anywhere on disk. Narrow this in `src-tauri/tauri.conf.json` if you only ever
  open notes from one folder.
- Exported HTML embeds the KaTeX stylesheet but not its font files, so math in
  exported documents falls back to system fonts.

## License

Onionskin is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. The full text is in [LICENSE](LICENSE).

It is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
A PARTICULAR PURPOSE.

In practice that means you may use, study, modify and share it freely, and a
fork you distribute has to carry the same freedoms and ship its source.

Bundled dependencies keep their own licenses: CodeMirror, React, KaTeX,
marked and Zustand are MIT; Lucide is ISC; DOMPurify is MPL-2.0 or
Apache-2.0; Tauri is MIT or Apache-2.0. All of those are compatible with
GPLv3 — which is part of why the license is v3-or-later and not v2 — and
each keeps its own notice inside `node_modules`.
