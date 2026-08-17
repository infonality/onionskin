/** Parsing, formatting and editing of GitHub-flavoured Markdown tables. */

export type Align = "left" | "center" | "right" | null;

export interface TableModel {
  /** Row 0 is the header; the delimiter line is not included. */
  rows: string[][];
  aligns: Align[];
}

/** Splits a table row on pipes that are not backslash-escaped. */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let escaped = false;
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");

  for (const ch of trimmed) {
    if (escaped) {
      cur += ch;
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
      cur += ch;
    } else if (ch === "|") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

export function alignmentsOf(delimiter: string): Align[] {
  return splitRow(delimiter).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

/** True when the line looks like a table's `| --- | :-: |` separator. */
export function isDelimiterRow(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");
}

export function parseTable(lines: string[]): TableModel {
  const header = splitRow(lines[0] ?? "");
  const aligns = lines.length > 1 && isDelimiterRow(lines[1]) ? alignmentsOf(lines[1]) : [];
  const body = lines
    .slice(2)
    .filter((l) => l.trim())
    .map(splitRow);

  // Per GFM the header row fixes the column count: short body rows are padded
  // and long ones are truncated, rather than widening the table.
  const columns = Math.max(header.length, aligns.length, 1);
  const pad = (row: string[]) => {
    const next = row.slice(0, columns);
    while (next.length < columns) next.push("");
    return next;
  };

  return {
    rows: [pad(header), ...body.map(pad)],
    aligns: Array.from({ length: columns }, (_, i) => aligns[i] ?? null),
  };
}

/** Visible width, counting wide CJK glyphs as two columns. */
function width(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(ch)
      ? 2
      : 1;
  }
  return w;
}

function padTo(text: string, target: number): string {
  return text + " ".repeat(Math.max(0, target - width(text)));
}

function delimiterCell(align: Align, size: number): string {
  const n = Math.max(size, align === "center" ? 3 : align ? 2 : 3);
  switch (align) {
    case "left":
      return ":" + "-".repeat(n - 1);
    case "right":
      return "-".repeat(n - 1) + ":";
    case "center":
      return ":" + "-".repeat(n - 2) + ":";
    default:
      return "-".repeat(n);
  }
}

/** Renders a model back to aligned Markdown source lines. */
export function renderTable(model: TableModel): string[] {
  const columns = model.aligns.length;
  const widths = Array.from({ length: columns }, (_, i) =>
    Math.max(3, ...model.rows.map((row) => width(row[i] ?? ""))),
  );

  const line = (cells: string[]) =>
    "| " + cells.map((cell, i) => padTo(cell ?? "", widths[i])).join(" | ") + " |";

  return [
    line(model.rows[0] ?? []),
    "| " + model.aligns.map((a, i) => delimiterCell(a, widths[i])).join(" | ") + " |",
    ...model.rows.slice(1).map(line),
  ];
}

// --- editing operations ------------------------------------------------------
// Each returns a new model; `row` 0 is the header and can never be removed.

const blankRow = (columns: number) => Array.from({ length: columns }, () => "");

export function insertRow(model: TableModel, at: number): TableModel {
  const index = Math.min(Math.max(at, 1), model.rows.length);
  const rows = [...model.rows];
  rows.splice(index, 0, blankRow(model.aligns.length));
  return { ...model, rows };
}

export function deleteRow(model: TableModel, at: number): TableModel {
  if (at <= 0 || at >= model.rows.length) return model;
  const rows = [...model.rows];
  rows.splice(at, 1);
  return { ...model, rows };
}

export function moveRow(model: TableModel, at: number, delta: number): TableModel {
  const target = at + delta;
  if (at <= 0 || target <= 0 || at >= model.rows.length || target >= model.rows.length) return model;
  const rows = [...model.rows];
  const [moved] = rows.splice(at, 1);
  rows.splice(target, 0, moved);
  return { ...model, rows };
}

export function insertColumn(model: TableModel, at: number): TableModel {
  const index = Math.min(Math.max(at, 0), model.aligns.length);
  const aligns = [...model.aligns];
  aligns.splice(index, 0, null);
  return {
    aligns,
    rows: model.rows.map((row) => {
      const next = [...row];
      next.splice(index, 0, "");
      return next;
    }),
  };
}

export function deleteColumn(model: TableModel, at: number): TableModel {
  if (model.aligns.length <= 1 || at < 0 || at >= model.aligns.length) return model;
  const aligns = [...model.aligns];
  aligns.splice(at, 1);
  return {
    aligns,
    rows: model.rows.map((row) => {
      const next = [...row];
      next.splice(at, 1);
      return next;
    }),
  };
}

export function setAlignment(model: TableModel, at: number, align: Align): TableModel {
  if (at < 0 || at >= model.aligns.length) return model;
  const aligns = [...model.aligns];
  aligns[at] = align;
  return { ...model, aligns };
}
