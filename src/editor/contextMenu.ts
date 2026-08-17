import { copyLineDown, deleteLine, moveLineDown, moveLineUp, selectAll } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import type { EditorView } from "@codemirror/view";
import { readText, writeHtml, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MenuNode } from "../components/ContextMenu";
import { renderDocumentFragment } from "../lib/export";
import { revealEntry } from "../lib/ipc";
import { resolveResource } from "../lib/markdown";
import { dirname, isAbsolute, join, relative } from "../lib/path";
import {
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  moveRow,
  setAlignment,
  type Align,
} from "../lib/table";
import { followLink } from "../state/actions";
import { useStore } from "../state/store";
import { editorActions, insertImage } from "./commands";
import { applyTableEdit, tableAt } from "./tableEdit";

function toast(message: string, tone: "info" | "error" = "info") {
  useStore.getState().pushToast(message, tone);
}

async function guard(action: () => Promise<void>, failure: string) {
  try {
    await action();
  } catch {
    toast(failure, "error");
  }
}

function ancestorOfType(view: EditorView, pos: number, names: string[]): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1);
  while (node) {
    if (names.includes(node.name)) return node;
    node = node.parent;
  }
  return null;
}

/**
 * Text to act on: the selection, or the whole line (including its break, so a
 * cut removes the row rather than blanking it) when nothing is selected.
 */
function operativeRange(view: EditorView) {
  const doc = view.state.doc;
  const range = view.state.selection.main;
  if (!range.empty) return { from: range.from, to: range.to, wholeLine: false };
  const line = doc.lineAt(range.head);
  return { from: line.from, to: Math.min(line.to + 1, doc.length), wholeLine: true };
}

function stripMarkdown(source: string): string {
  const holder = document.createElement("div");
  holder.innerHTML = renderDocumentFragment(source, null);
  return (holder.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function insertAtSelection(view: EditorView, text: string) {
  const range = view.state.selection.main;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
    userEvent: "input.paste",
  });
  view.focus();
}

export interface EditorMenuContext {
  /** Path of the document, for resolving relative resources. */
  docPath: string | null;
}

/**
 * Builds the editor's context menu for a right-click, tailored to whatever is
 * under the pointer: a link, an image, a table cell, a code block or plain text.
 */
export function buildEditorMenu(
  view: EditorView,
  event: MouseEvent,
  ctx: EditorMenuContext,
): MenuNode[] {
  const target = event.target as HTMLElement | null;

  // Resolve the document position under the pointer. Rendered blocks report
  // their own position; everything else uses the non-precise coordinate lookup,
  // which clamps to the nearest position rather than returning null and
  // leaving us to build a menu for wherever the caret happened to be.
  let pos: number | null = null;
  const widget = target?.closest?.(
    ".cm-md-table, .cm-md-image, .cm-md-math, .cm-md-html, .cm-md-hr, .cm-md-frontmatter",
  ) as HTMLElement | null;

  if (widget) {
    try {
      pos = view.posAtDOM(widget);
    } catch {
      pos = null;
    }
  }
  if (pos == null) {
    try {
      pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    } catch {
      pos = null;
    }
  }
  const previous = view.state.selection.main;
  if (pos == null) pos = previous.head;

  // Right-clicking outside the selection moves the caret there, like every
  // other editor; right-clicking inside it keeps the selection.
  const insideSelection = !previous.empty && pos >= previous.from && pos <= previous.to;
  if (!insideSelection) view.dispatch({ selection: { anchor: pos } });

  const state = view.state;
  const selection = state.selection.main;
  const caret = insideSelection ? selection.head : pos;
  const line = state.doc.lineAt(caret);
  const hasSelection = !selection.empty;
  const selectedText = hasSelection ? state.sliceDoc(selection.from, selection.to) : "";

  const items: MenuNode[] = [];

  // ---- link ---------------------------------------------------------------
  const linkEl = target?.closest?.("[data-href]") as HTMLElement | null;
  const linkNode = ancestorOfType(view, caret, ["Link", "Autolink"]);
  const urlNode = linkNode?.getChild("URL") ?? null;
  const href =
    linkEl?.getAttribute("data-href") ??
    (urlNode ? state.sliceDoc(urlNode.from, urlNode.to) : null) ??
    (linkNode?.name === "Autolink"
      ? state.sliceDoc(linkNode.from, linkNode.to).replace(/^<|>$/g, "")
      : null);

  if (href) {
    items.push(
      {
        label: /^(https?:|mailto:)/i.test(href) ? "Open Link in Browser" : "Open Linked Document",
        run: () => void followLink(href, useStore.getState().activeDoc()),
      },
      {
        label: "Copy Link Address",
        run: () => void guard(() => writeText(href), "Could not copy the link."),
      },
    );
    if (urlNode && linkNode) {
      items.push(
        {
          label: "Edit Link Address…",
          run: () => {
            view.dispatch({ selection: { anchor: urlNode.from, head: urlNode.to } });
            view.focus();
          },
        },
        {
          label: "Remove Link",
          run: () => {
            const marks = linkNode.getChildren("LinkMark");
            const label =
              marks.length >= 2 ? state.sliceDoc(marks[0].to, marks[1].from) : href;
            view.dispatch({
              changes: { from: linkNode.from, to: linkNode.to, insert: label },
              userEvent: "input.format",
            });
            view.focus();
          },
        },
      );
    }
    items.push("-");
  }

  // ---- image --------------------------------------------------------------
  const imageNode = ancestorOfType(view, caret, ["Image"]);
  if (imageNode) {
    const srcNode = imageNode.getChild("URL");
    const src = srcNode ? state.sliceDoc(srcNode.from, srcNode.to) : "";
    const absolute =
      src && !/^(https?:|data:)/i.test(src)
        ? isAbsolute(src)
          ? src
          : ctx.docPath
            ? join(dirname(ctx.docPath), decodeURIComponent(src))
            : null
        : null;

    items.push({
      label: "Open Image",
      disabled: !src,
      run: () =>
        void guard(
          () => openUrl(absolute ?? resolveResource(src, ctx.docPath)),
          "Could not open that image.",
        ),
    });
    items.push({
      label: "Copy Image Path",
      disabled: !src,
      run: () => void guard(() => writeText(absolute ?? src), "Could not copy the path."),
    });
    if (absolute) {
      items.push({
        label: "Reveal Image in File Manager",
        run: () => void guard(() => revealEntry(absolute), "Could not reveal that image."),
      });
    }
    if (srcNode) {
      items.push({
        label: "Replace Image…",
        run: async () => {
          const picked = await openDialog({
            multiple: false,
            filters: [
              {
                name: "Images",
                extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp", "avif"],
              },
            ],
          });
          if (typeof picked !== "string") return;
          const base = ctx.docPath ? dirname(ctx.docPath) : null;
          const next = (base ? relative(base, picked) : picked).replace(/ /g, "%20");
          view.dispatch({
            changes: { from: srcNode.from, to: srcNode.to, insert: next },
            userEvent: "input.format",
          });
          view.focus();
        },
      });
    }
    items.push("-");
  }

  // ---- table --------------------------------------------------------------
  const table = tableAt(view, caret, target);
  if (table) {
    const alignItem = (label: string, align: Align): MenuNode => ({
      label,
      checked: table.model.aligns[table.column] === align,
      run: () =>
        applyTableEdit(view, table, (m) => setAlignment(m, table.column, align)),
    });

    items.push({
      label: "Table",
      submenu: [
        {
          label: "Insert Row Above",
          disabled: table.row === 0,
          run: () => applyTableEdit(view, table, (m) => insertRow(m, table.row), table.row),
        },
        {
          label: "Insert Row Below",
          run: () =>
            applyTableEdit(view, table, (m) => insertRow(m, table.row + 1), table.row + 1),
        },
        {
          label: "Insert Column Left",
          run: () => applyTableEdit(view, table, (m) => insertColumn(m, table.column)),
        },
        {
          label: "Insert Column Right",
          run: () => applyTableEdit(view, table, (m) => insertColumn(m, table.column + 1)),
        },
        "-",
        {
          label: "Move Row Up",
          disabled: table.row <= 1,
          run: () =>
            applyTableEdit(view, table, (m) => moveRow(m, table.row, -1), table.row - 1),
        },
        {
          label: "Move Row Down",
          disabled: table.row === 0 || table.row >= table.model.rows.length - 1,
          run: () =>
            applyTableEdit(view, table, (m) => moveRow(m, table.row, 1), table.row + 1),
        },
        "-",
        {
          label: "Align Column",
          submenu: [
            alignItem("Default", null),
            alignItem("Left", "left"),
            alignItem("Center", "center"),
            alignItem("Right", "right"),
          ],
        },
        "-",
        {
          label: "Delete Row",
          danger: true,
          disabled: table.row === 0 || table.model.rows.length <= 2,
          run: () =>
            applyTableEdit(
              view,
              table,
              (m) => deleteRow(m, table.row),
              Math.min(table.row, table.model.rows.length - 2),
            ),
        },
        {
          label: "Delete Column",
          danger: true,
          disabled: table.model.aligns.length <= 1,
          run: () => applyTableEdit(view, table, (m) => deleteColumn(m, table.column)),
        },
        {
          label: "Delete Table",
          danger: true,
          run: () => {
            view.dispatch({
              changes: { from: table.from, to: table.to, insert: "" },
              userEvent: "delete",
            });
            view.focus();
          },
        },
      ],
    });
    items.push("-");
  }

  // ---- code block ---------------------------------------------------------
  const codeNode = ancestorOfType(view, caret, ["FencedCode", "CodeBlock"]);
  if (codeNode) {
    items.push({
      label: "Copy Code Block",
      run: () => {
        const body = state
          .sliceDoc(codeNode.from, codeNode.to)
          .replace(/^\s*(`{3,}|~{3,}).*\n?/, "")
          .replace(/\n?\s*(`{3,}|~{3,})\s*$/, "");
        void guard(() => writeText(body), "Could not copy the code.");
      },
    });
    items.push("-");
  }

  // ---- task ---------------------------------------------------------------
  if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(line.text)) {
    items.push(
      {
        label: /\[[xX]\]/.test(line.text) ? "Mark Task Incomplete" : "Mark Task Complete",
        keys: "Mod+Enter",
        run: () => {
          editorActions["toggle-task"](view);
          view.focus();
        },
      },
      "-",
    );
  }

  // ---- clipboard ----------------------------------------------------------
  const op = operativeRange(view);
  const opText = state.sliceDoc(op.from, op.to);

  items.push(
    {
      label: op.wholeLine ? "Cut Line" : "Cut",
      keys: "Mod+X",
      disabled: !opText,
      run: () =>
        void guard(async () => {
          await writeText(opText);
          view.dispatch({ changes: { from: op.from, to: op.to, insert: "" }, userEvent: "cut" });
          view.focus();
        }, "Could not cut to the clipboard."),
    },
    {
      label: op.wholeLine ? "Copy Line" : "Copy",
      keys: "Mod+C",
      disabled: !opText,
      run: () => void guard(() => writeText(opText), "Could not copy to the clipboard."),
    },
    {
      label: "Paste",
      keys: "Mod+V",
      run: () =>
        void guard(async () => {
          const text = await readText();
          if (text) insertAtSelection(view, text);
        }, "Could not read the clipboard."),
    },
    {
      label: "Paste Special",
      submenu: [
        {
          label: "As Code Block",
          run: () =>
            void guard(async () => {
              const text = (await readText()) ?? "";
              if (text) insertAtSelection(view, `\`\`\`\n${text.replace(/\n+$/, "")}\n\`\`\`\n`);
            }, "Could not read the clipboard."),
        },
        {
          label: "As Blockquote",
          run: () =>
            void guard(async () => {
              const text = (await readText()) ?? "";
              if (text) {
                insertAtSelection(
                  view,
                  text
                    .replace(/\n+$/, "")
                    .split("\n")
                    .map((l) => `> ${l}`)
                    .join("\n") + "\n",
                );
              }
            }, "Could not read the clipboard."),
        },
        {
          label: "As Link",
          run: () =>
            void guard(async () => {
              const url = ((await readText()) ?? "").trim();
              if (!url) return;
              insertAtSelection(view, `[${selectedText || url}](${url})`);
            }, "Could not read the clipboard."),
        },
        {
          label: "As Plain Text",
          run: () =>
            void guard(async () => {
              const text = (await readText()) ?? "";
              if (text) insertAtSelection(view, stripMarkdown(text));
            }, "Could not read the clipboard."),
        },
      ],
    },
    "-",
  );

  // ---- formatting ---------------------------------------------------------
  const headingLevel = /^(#{1,6})\s/.exec(line.text)?.[1].length ?? 0;
  const act = (id: string) => () => {
    editorActions[id]?.(view);
    view.focus();
  };

  items.push(
    {
      label: "Format",
      submenu: [
        { label: "Bold", keys: "Mod+B", run: act("bold") },
        { label: "Italic", keys: "Mod+I", run: act("italic") },
        { label: "Strikethrough", keys: "Mod+Shift+X", run: act("strike") },
        { label: "Inline Code", keys: "Mod+E", run: act("inline-code") },
        { label: "Highlight", keys: "Mod+Shift+H", run: act("highlight") },
      ],
    },
    {
      label: "Heading",
      submenu: [
        { label: "Paragraph", keys: "Mod+0", checked: headingLevel === 0, run: act("paragraph") },
        "-",
        ...([1, 2, 3, 4, 5, 6] as const).map((n) => ({
          label: `Heading ${n}`,
          keys: `Mod+${n}`,
          checked: headingLevel === n,
          run: act(`h${n}`),
        })),
      ],
    },
    {
      label: "List",
      submenu: [
        { label: "Bulleted List", keys: "Mod+Shift+8", run: act("list-bullet") },
        { label: "Numbered List", keys: "Mod+Shift+9", run: act("list-ordered") },
        { label: "Task List", keys: "Mod+Shift+0", run: act("list-task") },
        "-",
        { label: "Blockquote", keys: "Mod+Shift+Q", run: act("quote") },
      ],
    },
    {
      label: "Insert",
      submenu: [
        { label: "Link", keys: "Mod+L", run: act("link") },
        {
          label: "Image…",
          run: async () => {
            const picked = await openDialog({
              multiple: false,
              filters: [
                {
                  name: "Images",
                  extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp", "avif"],
                },
              ],
            });
            if (typeof picked !== "string") return;
            const base = ctx.docPath ? dirname(ctx.docPath) : null;
            const href2 = (base ? relative(base, picked) : picked).replace(/ /g, "%20");
            insertImage(href2)(view);
          },
        },
        { label: "Table", keys: "Mod+Shift+T", run: act("table") },
        { label: "Code Block", keys: "Mod+Shift+K", run: act("code-block") },
        {
          label: "Math Block",
          run: () => {
            const at = line.to;
            const insert = `${line.text ? "\n" : ""}$$\n\n$$\n`;
            view.dispatch({
              changes: { from: at, to: at, insert },
              selection: { anchor: at + insert.indexOf("\n\n$$") + 1 },
              userEvent: "input.format",
            });
            view.focus();
          },
        },
        { label: "Horizontal Rule", keys: "Mod+Shift+R", run: act("hr") },
      ],
    },
    {
      label: "Line",
      submenu: [
        {
          label: "Duplicate Line",
          run: () => {
            copyLineDown(view);
            view.focus();
          },
        },
        {
          label: "Move Line Up",
          run: () => {
            moveLineUp(view);
            view.focus();
          },
        },
        {
          label: "Move Line Down",
          run: () => {
            moveLineDown(view);
            view.focus();
          },
        },
        "-",
        {
          label: "Delete Line",
          danger: true,
          run: () => {
            deleteLine(view);
            view.focus();
          },
        },
      ],
    },
    "-",
  );

  // ---- copy conversions ---------------------------------------------------
  const doc = useStore.getState().activeDoc();
  items.push(
    {
      label: hasSelection ? "Copy Selection as HTML" : "Copy Document as HTML",
      run: () => {
        const source = hasSelection ? selectedText : state.doc.toString();
        const html = renderDocumentFragment(source, ctx.docPath);
        void guard(() => writeHtml(html, stripMarkdown(source)), "Could not copy as HTML.");
      },
    },
    {
      label: hasSelection ? "Copy Selection as Plain Text" : "Copy Document as Plain Text",
      run: () => {
        const source = hasSelection ? selectedText : state.doc.toString();
        void guard(() => writeText(stripMarkdown(source)), "Could not copy as plain text.");
      },
    },
    {
      label: "Select All",
      keys: "Mod+A",
      run: () => {
        selectAll(view);
        view.focus();
      },
    },
  );

  if (doc?.path) {
    items.push(
      "-",
      {
        label: "Copy File Path",
        run: () => void guard(() => writeText(doc.path as string), "Could not copy the path."),
      },
      {
        label: "Show in File Manager",
        run: () =>
          void guard(() => revealEntry(doc.path as string), "Could not open the file manager."),
      },
    );
  }

  return items;
}
