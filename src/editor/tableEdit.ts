import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  parseTable,
  renderTable,
  type Align,
  type TableModel,
} from "../lib/table";

export interface TableTarget {
  from: number;
  to: number;
  startLine: number;
  model: TableModel;
  /** Row index within the model: 0 is the header. */
  row: number;
  /** Zero-based column index. */
  column: number;
}

/** Maps a source line offset within a table to a model row index. */
function rowFromLineOffset(offset: number): number {
  // Source line 0 is the header, line 1 the delimiter, line 2+ the body.
  return offset <= 0 ? 0 : Math.max(1, offset - 1);
}

/** Counts unescaped pipes to the left of `column` in a row's text. */
function columnFromOffset(text: string, offset: number): number {
  let index = -1;
  let escaped = false;
  for (let i = 0; i < Math.min(offset, text.length); i++) {
    const ch = text[i];
    if (escaped) escaped = false;
    else if (ch === "\\") escaped = true;
    else if (ch === "|") index++;
  }
  return Math.max(0, index);
}

function readTable(state: EditorState, from: number, to: number) {
  const startLine = state.doc.lineAt(from).number;
  const endLine = state.doc.lineAt(to).number;
  const lines: string[] = [];
  for (let n = startLine; n <= endLine; n++) lines.push(state.doc.line(n).text);
  return {
    from: state.doc.line(startLine).from,
    to: state.doc.line(endLine).to,
    startLine,
    model: parseTable(lines),
  };
}

/**
 * Locates the table under a caret position, or under a click inside a rendered
 * table widget (which knows its own row and cell).
 */
export function tableAt(
  view: EditorView,
  pos: number,
  target?: HTMLElement | null,
): TableTarget | null {
  const state = view.state;
  const widget = target?.closest?.(".cm-md-table") as HTMLElement | null;

  if (widget) {
    const start = view.posAtDOM(widget);
    const base = readTable(state, start, start);
    // The widget replaces the whole table, so re-read using its real extent.
    const node = syntaxTree(state).resolveInner(start + 1, 1);
    let table = node;
    while (table.parent && table.name !== "Table") table = table.parent;
    const info = table.name === "Table" ? readTable(state, table.from, table.to) : base;

    const tr = target?.closest?.("tr") as HTMLTableRowElement | null;
    const cell = target?.closest?.("td, th") as HTMLTableCellElement | null;
    return {
      ...info,
      row: rowFromLineOffset(Number(tr?.dataset.lineOffset ?? 0)),
      column: cell?.cellIndex ?? 0,
    };
  }

  let node = syntaxTree(state).resolveInner(pos, 0);
  while (node.parent && node.name !== "Table") node = node.parent;
  if (node.name !== "Table") return null;

  const info = readTable(state, node.from, node.to);
  const line = state.doc.lineAt(pos);
  return {
    ...info,
    row: rowFromLineOffset(line.number - info.startLine),
    column: columnFromOffset(line.text, pos - line.from),
  };
}

/**
 * Applies a model transform, writes the re-aligned table back, and drops the
 * caret into the first cell of `focusRow` so the user can keep typing.
 */
export function applyTableEdit(
  view: EditorView,
  target: TableTarget,
  transform: (model: TableModel) => TableModel,
  focusRow = target.row,
) {
  const next = transform(target.model);
  const lines = renderTable(next);
  const text = lines.join("\n");

  // Model row 0 is source line 0; row n lives on source line n + 1.
  const row = Math.max(0, Math.min(focusRow, next.rows.length - 1));
  const lineIndex = row === 0 ? 0 : row + 1;
  let offset = 0;
  for (let i = 0; i < lineIndex && i < lines.length; i++) offset += lines[i].length + 1;
  const firstCell = offset + (lines[lineIndex]?.startsWith("| ") ? 2 : 0);

  view.dispatch({
    changes: { from: target.from, to: target.to, insert: text },
    selection: { anchor: target.from + Math.min(firstCell, text.length) },
    userEvent: "input.table",
    scrollIntoView: true,
  });
  view.focus();
}

export type { Align, TableModel };
