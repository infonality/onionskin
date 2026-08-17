import { syntaxTree } from "@codemirror/language";
import {
  EditorState,
  Facet,
  Range,
  RangeSet,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { renderMarkdown } from "../lib/markdown";
import {
  BlankWidget,
  BulletWidget,
  CheckboxWidget,
  FrontMatterWidget,
  HorizontalRuleWidget,
  HtmlWidget,
  ImageWidget,
  LanguageChipWidget,
  MathWidget,
  TableWidget,
} from "./widgets";

/** Absolute path of the document in the editor, for resolving relative images. */
export const docPathFacet = Facet.define<string | null, string | null>({
  combine: (values) => (values.length ? values[0] : null),
});

/** When true the editor shows raw markdown with no live rendering. */
export const sourceModeFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

const hiddenDeco = Decoration.replace({});

const lineCache = new Map<string, Decoration>();
function lineDeco(cls: string): Decoration {
  let d = lineCache.get(cls);
  if (!d) {
    d = Decoration.line({ class: cls });
    lineCache.set(cls, d);
  }
  return d;
}

const markCache = new Map<string, Decoration>();
function markDeco(cls: string): Decoration {
  let d = markCache.get(cls);
  if (!d) {
    d = Decoration.mark({ class: cls });
    markCache.set(cls, d);
  }
  return d;
}

/**
 * Which parts of the document currently have the caret in them. Large
 * selections are ignored so that "select all" does not unfold the whole file.
 */
function activity(state: EditorState) {
  const doc = state.doc;
  const ranges = state.selection.ranges.filter((r) => {
    const a = doc.lineAt(r.from).number;
    const b = doc.lineAt(r.to).number;
    return b - a <= 3;
  });

  const lines = new Set<number>();
  for (const r of ranges) {
    const a = doc.lineAt(r.from).number;
    const b = doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) lines.add(n);
  }

  return {
    /** True when a caret or small selection overlaps [from, to]. */
    touches(from: number, to: number) {
      return ranges.some((r) => r.from <= to && r.to >= from);
    },
    lineActive(n: number) {
      return lines.has(n);
    },
    linesActive(a: number, b: number) {
      for (let n = a; n <= b; n++) if (lines.has(n)) return true;
      return false;
    },
  };
}

function frontMatterRange(state: EditorState): { from: number; to: number; fields: string[] } | null {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") return null;
  for (let n = 2; n <= Math.min(doc.lines, 200); n++) {
    const text = doc.line(n).text.trim();
    if (text === "---" || text === "...") {
      const fields: string[] = [];
      for (let i = 2; i < n; i++) {
        const m = /^([A-Za-z_][\w .-]*)\s*:/.exec(doc.line(i).text);
        if (m) fields.push(m[1].trim());
      }
      return { from: doc.line(1).from, to: doc.line(n).to, fields };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Block-level replacements.
//
// Widgets that span line breaks have to come from a state field — CodeMirror
// does not allow view plugins to replace newlines.
// ---------------------------------------------------------------------------

function buildBlockDecorations(state: EditorState): DecorationSet {
  if (state.facet(sourceModeFacet)) return Decoration.none;

  const doc = state.doc;
  const act = activity(state);
  const ranges: Range<Decoration>[] = [];
  const codeRanges: Array<[number, number]> = [];

  const front = frontMatterRange(state);
  if (front && !act.linesActive(doc.lineAt(front.from).number, doc.lineAt(front.to).number)) {
    ranges.push(
      Decoration.replace({
        widget: new FrontMatterWidget(front.fields),
        block: true,
      }).range(front.from, front.to),
    );
  }

  const blockedFrom = front ? front.to : -1;

  syntaxTree(state).iterate({
    enter(node) {
      if (node.to <= blockedFrom) return false;

      const name = node.name;

      if (name === "FencedCode" || name === "CodeBlock") {
        codeRanges.push([node.from, node.to]);
        return false;
      }

      if (name === "HorizontalRule") {
        const line = doc.lineAt(node.from);
        if (!act.lineActive(line.number)) {
          ranges.push(
            Decoration.replace({
              widget: new HorizontalRuleWidget(),
              block: true,
            }).range(line.from, line.to),
          );
        }
        return false;
      }

      if (name === "Table") {
        const first = doc.lineAt(node.from);
        const last = doc.lineAt(node.to);
        if (!act.linesActive(first.number, last.number)) {
          ranges.push(
            Decoration.replace({
              widget: new TableWidget(doc.sliceString(first.from, last.to)),
              block: true,
            }).range(first.from, last.to),
          );
        }
        return false;
      }

      if (name === "HTMLBlock") {
        const first = doc.lineAt(node.from);
        const last = doc.lineAt(node.to);
        const source = doc.sliceString(first.from, last.to);
        // A lone comment or an opening tag on its own is not worth rendering.
        if (
          !act.linesActive(first.number, last.number) &&
          source.length < 20_000 &&
          !source.trimStart().startsWith("<!--")
        ) {
          ranges.push(
            Decoration.replace({
              widget: new HtmlWidget(renderMarkdown(source), state.facet(docPathFacet)),
              block: true,
            }).range(first.from, last.to),
          );
        }
        return false;
      }

      return undefined;
    },
  });

  // Display math: `$$ … $$` spanning one or more lines, outside code. This
  // needs the whole document as a string, so very large files opt out.
  if (doc.length <= 400_000) {
    const text = doc.toString();
    const displayMath = /\$\$([^$]|\$(?!\$))*?\$\$/g;
    let m: RegExpExecArray | null;
    while ((m = displayMath.exec(text))) {
      const from = m.index;
      const to = from + m[0].length;
      if (from < blockedFrom) continue;
      if (codeRanges.some(([f, t]) => from < t && to > f)) continue;

      const first = doc.lineAt(from);
      const last = doc.lineAt(to);
      // Only treat it as a block when it owns its lines end to end.
      if (first.from !== from || last.to !== to) continue;
      if (act.linesActive(first.number, last.number)) continue;

      const tex = m[0].slice(2, -2).trim();
      if (!tex) continue;
      ranges.push(
        Decoration.replace({ widget: new MathWidget(tex, true), block: true }).range(from, to),
      );
    }
  }

  return Decoration.set(ranges, true);
}

export const blockField = StateField.define<DecorationSet>({
  create: buildBlockDecorations,
  update(value, tr) {
    if (
      !tr.docChanged &&
      !tr.selection &&
      tr.startState.facet(docPathFacet) === tr.state.facet(docPathFacet) &&
      tr.startState.facet(sourceModeFacet) === tr.state.facet(sourceModeFacet)
    ) {
      return value.map(tr.changes);
    }
    return buildBlockDecorations(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---------------------------------------------------------------------------
// Inline styling and folding, scoped to the viewport.
// ---------------------------------------------------------------------------

const HEADING_RE = /^(ATX|Setext)Heading([1-6])$/;

class InlineBuilder {
  readonly ranges: Range<Decoration>[] = [];
  /** Regions already replaced; used to keep replacements from overlapping. */
  private readonly claimed: Array<[number, number]> = [];
  private vFrom = 0;
  private vTo = 0;

  constructor(
    readonly state: EditorState,
    readonly act: ReturnType<typeof activity>,
    blocks: DecorationSet,
  ) {
    blocks.between(0, state.doc.length, (from, to) => {
      this.claimed.push([from, to]);
    });
  }

  setViewport(from: number, to: number) {
    this.vFrom = from;
    this.vTo = to;
  }

  private conflicts(from: number, to: number) {
    for (const [f, t] of this.claimed) if (from < t && to > f) return true;
    return false;
  }

  replace(from: number, to: number, widget?: WidgetType) {
    if (from >= to || this.conflicts(from, to)) return;
    this.claimed.push([from, to]);
    this.ranges.push(
      (widget ? Decoration.replace({ widget }) : hiddenDeco).range(from, to),
    );
  }

  mark(from: number, to: number, cls: string) {
    if (from >= to) return;
    this.ranges.push(markDeco(cls).range(from, to));
  }

  markWith(from: number, to: number, deco: Decoration) {
    if (from >= to) return;
    this.ranges.push(deco.range(from, to));
  }

  lineClass(from: number, to: number, cls: string) {
    const doc = this.state.doc;
    const first = doc.lineAt(Math.max(from, this.vFrom)).number;
    const last = doc.lineAt(Math.min(to, this.vTo)).number;
    for (let n = first; n <= last; n++) {
      this.ranges.push(lineDeco(cls).range(doc.line(n).from));
    }
  }

  singleLineClass(pos: number, cls: string) {
    this.ranges.push(lineDeco(cls).range(this.state.doc.lineAt(pos).from));
  }

  atomicRanges(): RangeSet<Decoration> {
    const sorted = [...this.claimed].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return RangeSet.of(
      sorted.map(([f, t]) => hiddenDeco.range(f, t)),
      true,
    );
  }
}

function buildInlineDecorations(view: EditorView) {
  const state = view.state;
  if (state.facet(sourceModeFacet)) {
    return { decorations: Decoration.none, atomics: RangeSet.empty as RangeSet<Decoration> };
  }

  const doc = state.doc;
  const docPath = state.facet(docPathFacet);
  const act = activity(state);
  const b = new InlineBuilder(state, act, state.field(blockField, false) ?? Decoration.none);
  const codeRanges: Array<[number, number]> = [];
  const tree = syntaxTree(state);

  const sliceOf = (from: number, to: number) => doc.sliceString(from, to);

  for (const { from: vFrom, to: vTo } of view.visibleRanges) {
    b.setViewport(vFrom, vTo);

    tree.iterate({
      from: vFrom,
      to: vTo,
      enter(node) {
        const name = node.name;

        // ---- headings -----------------------------------------------------
        const heading = HEADING_RE.exec(name);
        if (heading) {
          const level = Number(heading[2]);
          b.lineClass(node.from, node.to, `cm-md-heading cm-md-h${level}`);
          if (heading[1] === "Setext") {
            const last = doc.lineAt(node.to);
            const first = doc.lineAt(node.from);
            if (!act.linesActive(first.number, last.number) && last.number > first.number) {
              b.singleLineClass(last.from, "cm-md-collapsed-line");
            }
          }
          return undefined;
        }

        if (name === "HeaderMark") {
          const line = doc.lineAt(node.from);
          if (act.lineActive(line.number)) {
            b.mark(node.from, node.to, "cm-md-syntax");
            return false;
          }
          if (/^[=-]+$/.test(sliceOf(node.from, node.to).trim())) {
            b.mark(node.from, node.to, "cm-md-syntax cm-md-faded");
            return false;
          }
          let to = node.to;
          if (sliceOf(to, to + 1) === " ") to += 1;
          b.replace(node.from, to);
          return false;
        }

        // ---- quotes -------------------------------------------------------
        if (name === "Blockquote") {
          b.lineClass(node.from, node.to, "cm-md-quote");
          return undefined;
        }

        if (name === "QuoteMark") {
          const line = doc.lineAt(node.from);
          if (act.lineActive(line.number)) {
            b.mark(node.from, node.to, "cm-md-syntax");
          } else {
            let to = node.to;
            if (sliceOf(to, to + 1) === " ") to += 1;
            b.replace(node.from, to);
          }
          return false;
        }

        // ---- lists --------------------------------------------------------
        if (name === "ListItem") {
          const line = doc.lineAt(node.from);
          const indent = Math.max(1, node.from - line.from + 2);
          b.ranges.push(
            Decoration.line({
              class: "cm-md-li",
              attributes: { style: `--md-hang:${indent}ch` },
            }).range(line.from),
          );
          return undefined;
        }

        if (name === "ListMark") {
          const line = doc.lineAt(node.from);
          const text = sliceOf(node.from, node.to);
          const ordered = /\d/.test(text);
          // A task item shows its checkbox instead of a bullet.
          const isTask = /^\s\[[ xX]\]/.test(sliceOf(node.to, node.to + 4));

          if (ordered) {
            b.mark(node.from, node.to, "cm-md-ordered-mark");
          } else if (act.lineActive(line.number)) {
            b.mark(node.from, node.to, "cm-md-syntax");
          } else if (isTask) {
            b.replace(node.from, node.to + 1);
          } else {
            b.replace(node.from, node.to, new BulletWidget(false));
          }
          return false;
        }

        if (name === "TaskMarker") {
          const checked = /[xX]/.test(sliceOf(node.from, node.to));
          b.replace(node.from, node.to, new CheckboxWidget(checked));
          if (checked) b.singleLineClass(node.from, "cm-md-task-done");
          return false;
        }

        // ---- code ---------------------------------------------------------
        if (name === "FencedCode") {
          codeRanges.push([node.from, node.to]);
          const first = doc.lineAt(node.from);
          const last = doc.lineAt(node.to);
          b.lineClass(node.from, node.to, "cm-md-codeblock");
          b.singleLineClass(first.from, "cm-md-codeblock-open");
          b.singleLineClass(last.from, "cm-md-codeblock-close");

          if (!act.linesActive(first.number, last.number)) {
            const info = node.node.getChild("CodeInfo");
            const lang = info ? sliceOf(info.from, info.to).trim() : "";
            b.singleLineClass(first.from, "cm-md-fence");
            b.replace(first.from, first.to, new LanguageChipWidget(lang));
            if (last.number !== first.number && /^\s*(`{3,}|~{3,})\s*$/.test(last.text)) {
              b.singleLineClass(last.from, "cm-md-fence");
              b.replace(last.from, last.to, new BlankWidget());
            }
          }
          return false;
        }

        if (name === "CodeBlock") {
          codeRanges.push([node.from, node.to]);
          b.lineClass(node.from, node.to, "cm-md-codeblock cm-md-codeblock-indent");
          return false;
        }

        if (name === "InlineCode") {
          codeRanges.push([node.from, node.to]);
          b.mark(node.from, node.to, "cm-md-code-inline");
          return undefined;
        }

        if (name === "CodeMark") {
          const parent = node.node.parent;
          if (parent && parent.name === "InlineCode") {
            if (act.touches(parent.from, parent.to)) {
              b.mark(node.from, node.to, "cm-md-syntax");
            } else {
              b.replace(node.from, node.to);
            }
          }
          return false;
        }

        // ---- emphasis -----------------------------------------------------
        if (name === "StrongEmphasis") {
          b.mark(node.from, node.to, "cm-md-strong");
          return undefined;
        }
        if (name === "Emphasis") {
          b.mark(node.from, node.to, "cm-md-em");
          return undefined;
        }
        if (name === "Strikethrough") {
          b.mark(node.from, node.to, "cm-md-strike");
          return undefined;
        }
        if (name === "EmphasisMark" || name === "StrikethroughMark") {
          const parent = node.node.parent;
          const from = parent ? parent.from : node.from;
          const to = parent ? parent.to : node.to;
          if (act.touches(from, to)) b.mark(node.from, node.to, "cm-md-syntax");
          else b.replace(node.from, node.to);
          return false;
        }

        // ---- links and images ---------------------------------------------
        if (name === "Image") {
          const n = node.node;
          if (act.touches(n.from, n.to)) {
            b.mark(n.from, n.to, "cm-md-image-src");
            return undefined;
          }
          const urlNode = n.getChild("URL");
          const src = urlNode ? sliceOf(urlNode.from, urlNode.to) : "";
          const marks = n.getChildren("LinkMark");
          const alt =
            marks.length >= 2 ? sliceOf(marks[0].to, marks[1].from) : "";
          const titleNode = n.getChild("LinkTitle");
          const title = titleNode
            ? sliceOf(titleNode.from, titleNode.to).replace(/^["'(]|["')]$/g, "")
            : "";
          b.replace(n.from, n.to, new ImageWidget(src, alt, title, docPath));
          return false;
        }

        if (name === "Link") {
          const n = node.node;
          const urlNode = n.getChild("URL");
          const url = urlNode ? sliceOf(urlNode.from, urlNode.to) : "";
          const marks = n.getChildren("LinkMark");
          const open = act.touches(n.from, n.to);

          if (!open && marks.length >= 2) {
            b.replace(n.from, marks[0].to);
            b.replace(marks[1].from, n.to);
            b.markWith(
              marks[0].to,
              marks[1].from,
              Decoration.mark({
                class: "cm-md-link",
                attributes: url ? { "data-href": url, title: url } : {},
              }),
            );
          } else {
            b.markWith(
              n.from,
              n.to,
              Decoration.mark({
                class: "cm-md-link is-open",
                attributes: url ? { "data-href": url } : {},
              }),
            );
          }
          return undefined;
        }

        if (name === "Autolink") {
          b.markWith(
            node.from,
            node.to,
            Decoration.mark({
              class: "cm-md-link",
              attributes: { "data-href": sliceOf(node.from, node.to).replace(/^<|>$/g, "") },
            }),
          );
          return false;
        }

        if (name === "LinkMark") {
          const line = doc.lineAt(node.from);
          if (!act.lineActive(line.number)) b.replace(node.from, node.to);
          else b.mark(node.from, node.to, "cm-md-syntax");
          return false;
        }

        if (name === "URL" || name === "LinkTitle") {
          b.mark(node.from, node.to, "cm-md-url");
          return false;
        }

        if (name === "Escape") {
          if (!act.touches(node.from, node.to)) b.replace(node.from, node.from + 1);
          return false;
        }

        return undefined;
      },
    });
  }

  // ---- regex passes: inline math and ==highlight== -------------------------
  const insideCode = (from: number, to: number) =>
    codeRanges.some(([f, t]) => from < t && to > f);

  for (const { from: vFrom, to: vTo } of view.visibleRanges) {
    b.setViewport(vFrom, vTo);
    const firstLine = doc.lineAt(vFrom).number;
    const lastLine = doc.lineAt(vTo).number;

    for (let n = firstLine; n <= lastLine; n++) {
      const line = doc.line(n);
      if (!line.text) continue;

      if (line.text.includes("==")) {
        const re = /==([^=\n]+)==/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line.text))) {
          const from = line.from + m.index;
          const to = from + m[0].length;
          if (insideCode(from, to)) continue;
          b.mark(from, to, "cm-md-highlight");
          if (!act.touches(from, to)) {
            b.replace(from, from + 2);
            b.replace(to - 2, to);
          } else {
            b.mark(from, from + 2, "cm-md-syntax");
            b.mark(to - 2, to, "cm-md-syntax");
          }
        }
      }

      if (line.text.includes("$")) {
        const re = /\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line.text))) {
          const from = line.from + m.index;
          const to = from + m[0].length;
          if (insideCode(from, to)) continue;
          if (act.touches(from, to)) {
            b.mark(from, to, "cm-md-math-src");
          } else {
            b.replace(from, to, new MathWidget(m[1], false));
          }
        }
      }
    }
  }

  return {
    decorations: Decoration.set(b.ranges, true),
    atomics: b.atomicRanges(),
  };
}

const inlinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomics: RangeSet<Decoration>;

    constructor(view: EditorView) {
      const built = buildInlineDecorations(view);
      this.decorations = built.decorations;
      this.atomics = built.atomics;
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.facet(docPathFacet) !== update.state.facet(docPathFacet) ||
        update.startState.facet(sourceModeFacet) !== update.state.facet(sourceModeFacet)
      ) {
        const built = buildInlineDecorations(update.view);
        this.decorations = built.decorations;
        this.atomics = built.atomics;
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomics ?? RangeSet.empty),
  },
);

export function livePreview(): Extension {
  return [blockField, inlinePlugin];
}
