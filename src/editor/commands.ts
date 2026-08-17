import { indentLess, indentMore } from "@codemirror/commands";
import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import { EditorView, type Command } from "@codemirror/view";

const WORD = /[\w'’À-ɏ-]/;

function wordAt(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let s = pos - line.from;
  let e = s;
  while (s > 0 && WORD.test(text[s - 1])) s--;
  while (e < text.length && WORD.test(text[e])) e++;
  return { from: line.from + s, to: line.from + e };
}

/**
 * Wraps (or unwraps) each selection in a pair of markers, the way a word
 * processor's bold button behaves.
 */
export function toggleWrap(before: string, after = before): Command {
  return (view) => {
    const doc = view.state.doc;
    view.dispatch(
      view.state.changeByRange((range) => {
        let { from, to } = range;
        if (range.empty) {
          const w = wordAt(view, range.head);
          from = w.from;
          to = w.to;
        }

        const outerBefore = doc.sliceString(Math.max(0, from - before.length), from);
        const outerAfter = doc.sliceString(to, Math.min(doc.length, to + after.length));
        const inner = doc.sliceString(from, to);

        if (outerBefore === before && outerAfter === after) {
          return {
            changes: [
              { from: from - before.length, to, insert: inner },
              { from: to, to: to + after.length, insert: "" },
            ],
            range: EditorSelection.range(from - before.length, to - before.length),
          };
        }

        if (
          inner.length >= before.length + after.length &&
          inner.startsWith(before) &&
          inner.endsWith(after)
        ) {
          const stripped = inner.slice(before.length, inner.length - after.length);
          return {
            changes: { from, to, insert: stripped },
            range: EditorSelection.range(from, from + stripped.length),
          };
        }

        return {
          changes: { from, to, insert: before + inner + after },
          range: inner
            ? EditorSelection.range(from + before.length, to + before.length)
            : EditorSelection.cursor(from + before.length),
        };
      }),
      { userEvent: "input.format" },
    );
    view.focus();
    return true;
  };
}

function selectedLines(view: EditorView) {
  const doc = view.state.doc;
  const lines: number[] = [];
  for (const range of view.state.selection.ranges) {
    const a = doc.lineAt(range.from).number;
    const b = doc.lineAt(range.to).number;
    for (let n = a; n <= b; n++) if (!lines.includes(n)) lines.push(n);
  }
  return lines.sort((a, b) => a - b);
}

const HEADING_PREFIX = /^(#{1,6})\s+/;

export function setHeading(level: number): Command {
  return (view) => {
    const doc = view.state.doc;
    const changes: ChangeSpec[] = [];

    for (const n of selectedLines(view)) {
      const line = doc.line(n);
      const existing = HEADING_PREFIX.exec(line.text);
      const body = existing ? line.text.slice(existing[0].length) : line.text;
      const alreadyAtLevel = existing && existing[1].length === level;
      const prefix = level === 0 || alreadyAtLevel ? "" : "#".repeat(level) + " ";
      const next = prefix + body;
      if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
    }

    if (changes.length) view.dispatch({ changes, userEvent: "input.format" });
    view.focus();
    return true;
  };
}

type ListKind = "bullet" | "ordered" | "task" | "quote";

const MARKERS: Record<ListKind, RegExp> = {
  bullet: /^(\s*)[-*+]\s+(?!\[[ xX]\]\s)/,
  ordered: /^(\s*)\d+[.)]\s+/,
  task: /^(\s*)[-*+]\s+\[[ xX]\]\s+/,
  quote: /^(\s*)>\s?/,
};

export function toggleBlock(kind: ListKind): Command {
  return (view) => {
    const doc = view.state.doc;
    const lines = selectedLines(view);
    const allMatch = lines.every((n) => MARKERS[kind].test(doc.line(n).text));
    const changes: ChangeSpec[] = [];
    let counter = 1;

    for (const n of lines) {
      const line = doc.line(n);
      let text = line.text;

      // Strip whichever list-ish prefix is already there.
      const indent = /^\s*/.exec(text)?.[0] ?? "";
      let body = text.slice(indent.length);
      body = body
        .replace(/^[-*+]\s+\[[ xX]\]\s+/, "")
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/^>\s?/, "");

      let next: string;
      if (allMatch) {
        next = indent + body;
      } else {
        const marker =
          kind === "bullet"
            ? "- "
            : kind === "ordered"
              ? `${counter++}. `
              : kind === "task"
                ? "- [ ] "
                : "> ";
        next = indent + marker + body;
      }

      if (next !== text) changes.push({ from: line.from, to: line.to, insert: next });
    }

    if (changes.length) view.dispatch({ changes, userEvent: "input.format" });
    view.focus();
    return true;
  };
}

/** Inserts a block of text on its own lines below the caret. */
export function insertBlock(text: string, caretOffset?: number): Command {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    const line = state.doc.lineAt(range.head);
    const prefix = range.head === line.from && !line.text ? "" : "\n";
    const insert = `${prefix}${text}\n`;
    const at = line.to;

    view.dispatch({
      changes: { from: at, to: at, insert },
      selection: {
        anchor: at + prefix.length + (caretOffset ?? text.length),
      },
      userEvent: "input.format",
      scrollIntoView: true,
    });
    view.focus();
    return true;
  };
}

export const insertHorizontalRule = insertBlock("---");

export const insertTable = insertBlock(
  ["| Column | Column |", "| --- | --- |", "|  |  |"].join("\n"),
  2,
);

export const insertCodeBlock: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  const line = state.doc.lineAt(range.from);
  const at = selected ? range.from : line.to;
  const prefix = selected || range.from === line.from ? "" : "\n";
  const body = selected || "";
  const insert = `${prefix}\`\`\`\n${body}\n\`\`\`\n`;

  view.dispatch({
    changes: { from: at, to: selected ? range.to : at, insert },
    selection: { anchor: at + prefix.length + 3 },
    userEvent: "input.format",
    scrollIntoView: true,
  });
  view.focus();
  return true;
};

export const insertLink: Command = (view) => {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
      const looksLikeUrl = /^(https?:\/\/|www\.)/i.test(text);
      const label = looksLikeUrl ? "" : text;
      const url = looksLikeUrl ? text : "";
      const insert = `[${label}](${url})`;
      const caret = looksLikeUrl
        ? range.from + 1
        : range.from + 1 + label.length + 2;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(caret),
      };
    }),
    { userEvent: "input.format" },
  );
  view.focus();
  return true;
};

export function insertImage(src: string, alt = ""): Command {
  return (view) => {
    const range = view.state.selection.main;
    const insert = `![${alt}](${src})`;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: { anchor: range.from + insert.length },
      userEvent: "input.format",
    });
    view.focus();
    return true;
  };
}

/** Enter inside a list or quote keeps the structure going. */
export const continueBlock: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;

  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to) return false;

  const listMatch = /^(\s*)(?:([-*+])|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(line.text);
  if (listMatch) {
    const [full, indent, bullet, num, delim, space, task] = listMatch;
    const isEmpty = line.text.slice(full.length).trim() === "";

    if (isEmpty) {
      // Second Enter on an empty item ends the list.
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: { anchor: line.from },
        userEvent: "input",
      });
      return true;
    }

    const marker = bullet
      ? `${bullet}${space}`
      : `${Number(num) + 1}${delim}${space}`;
    const insert = `\n${indent}${marker}${task ? "[ ] " : ""}`;
    view.dispatch({
      changes: { from: range.head, to: range.head, insert },
      selection: { anchor: range.head + insert.length },
      userEvent: "input",
      scrollIntoView: true,
    });
    return true;
  }

  const quoteMatch = /^(\s*>+\s?)/.exec(line.text);
  if (quoteMatch) {
    if (line.text.trim() === quoteMatch[1].trim()) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: { anchor: line.from },
        userEvent: "input",
      });
      return true;
    }
    const insert = `\n${quoteMatch[1]}`;
    view.dispatch({
      changes: { from: range.head, to: range.head, insert },
      selection: { anchor: range.head + insert.length },
      userEvent: "input",
      scrollIntoView: true,
    });
    return true;
  }

  return false;
};

const LIST_LINE = /^(\s*)(?:[-*+]|\d+[.)])\s+/;

export const listIndent: Command = (view) => {
  const doc = view.state.doc;
  const lines = selectedLines(view);
  if (!lines.some((n) => LIST_LINE.test(doc.line(n).text))) return indentMore(view);

  const changes = lines.map((n) => {
    const line = doc.line(n);
    return { from: line.from, to: line.from, insert: "  " };
  });
  view.dispatch({ changes, userEvent: "input.indent" });
  return true;
};

export const listOutdent: Command = (view) => {
  const doc = view.state.doc;
  const lines = selectedLines(view);
  if (!lines.some((n) => LIST_LINE.test(doc.line(n).text))) return indentLess(view);

  const changes = [];
  for (const n of lines) {
    const line = doc.line(n);
    const drop = /^ {1,2}/.exec(line.text)?.[0].length ?? 0;
    if (drop) changes.push({ from: line.from, to: line.from + drop, insert: "" });
  }
  if (changes.length) view.dispatch({ changes, userEvent: "delete.dedent" });
  return true;
};

/** Toggles the `[ ]` / `[x]` state of every task line touched by the selection. */
export const toggleTaskDone: Command = (view) => {
  const doc = view.state.doc;
  const changes: ChangeSpec[] = [];
  for (const n of selectedLines(view)) {
    const line = doc.line(n);
    const m = /^(\s*[-*+]\s+\[)([ xX])(\]\s)/.exec(line.text);
    if (!m) continue;
    const at = line.from + m[1].length;
    changes.push({ from: at, to: at + 1, insert: m[2] === " " ? "x" : " " });
  }
  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: "input.format" });
  return true;
};

/** Pasting a URL over a selection turns the selection into a link. */
export const pasteLinkHandler = EditorView.domEventHandlers({
  paste(event, view) {
    const text = event.clipboardData?.getData("text/plain")?.trim();
    if (!text || !/^https?:\/\/\S+$/i.test(text) || /\s/.test(text)) return false;
    const range = view.state.selection.main;
    if (range.empty) return false;

    event.preventDefault();
    const label = view.state.sliceDoc(range.from, range.to);
    const insert = `[${label}](${text})`;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: { anchor: range.from + insert.length },
      userEvent: "input.paste",
    });
    return true;
  },
});

export const editorActions: Record<string, Command> = {
  bold: toggleWrap("**"),
  italic: toggleWrap("*"),
  strike: toggleWrap("~~"),
  "inline-code": toggleWrap("`"),
  highlight: toggleWrap("=="),
  h1: setHeading(1),
  h2: setHeading(2),
  h3: setHeading(3),
  h4: setHeading(4),
  h5: setHeading(5),
  h6: setHeading(6),
  paragraph: setHeading(0),
  quote: toggleBlock("quote"),
  "list-bullet": toggleBlock("bullet"),
  "list-ordered": toggleBlock("ordered"),
  "list-task": toggleBlock("task"),
  "toggle-task": toggleTaskDone,
  link: insertLink,
  table: insertTable,
  "code-block": insertCodeBlock,
  hr: insertHorizontalRule,
};

export function runEditorAction(view: EditorView | null, id: string): boolean {
  if (!view) return false;
  const command = editorActions[id];
  if (!command) return false;
  return command(view);
}
