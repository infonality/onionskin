import { Facet, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  type DecorationSet,
} from "@codemirror/view";

/** Dim everything except the paragraph the caret is in. */
export const focusModeFacet = Facet.define<boolean, boolean>({
  combine: (v) => v.some(Boolean),
});

/** Keep the caret vertically centred while typing. */
export const typewriterFacet = Facet.define<boolean, boolean>({
  combine: (v) => v.some(Boolean),
});

const dimmedLine = Decoration.line({ class: "cm-md-dimmed" });

function buildFocusDecorations(view: EditorView): DecorationSet {
  if (!view.state.facet(focusModeFacet)) return Decoration.none;

  const doc = view.state.doc;
  const caretLine = doc.lineAt(view.state.selection.main.head).number;

  // The "focused" block is the run of non-blank lines around the caret.
  let start = caretLine;
  let end = caretLine;
  while (start > 1 && doc.line(start - 1).text.trim() !== "") start--;
  while (end < doc.lines && doc.line(end + 1).text.trim() !== "") end++;

  const ranges = [];
  for (const { from, to } of view.visibleRanges) {
    const a = doc.lineAt(from).number;
    const b = doc.lineAt(to).number;
    for (let n = a; n <= b; n++) {
      if (n < start || n > end) ranges.push(dimmedLine.range(doc.line(n).from));
    }
  }
  return Decoration.set(ranges, true);
}

const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildFocusDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.facet(focusModeFacet) !== update.state.facet(focusModeFacet)
      ) {
        this.decorations = buildFocusDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const typewriterScroll = EditorView.updateListener.of((update) => {
  if (!update.state.facet(typewriterFacet)) return;
  if (!update.docChanged && !update.selectionSet) return;

  const view = update.view;
  requestAnimationFrame(() => {
    if (!view.dom.isConnected || !view.hasFocus) return;
    const coords = view.coordsAtPos(view.state.selection.main.head);
    if (!coords) return;
    const scroller = view.scrollDOM;
    const box = scroller.getBoundingClientRect();
    const delta = coords.top - (box.top + box.height * 0.42);
    if (Math.abs(delta) > 2) scroller.scrollTop += delta;
  });
});

export function editorModes(): Extension {
  return [focusPlugin, typewriterScroll];
}
