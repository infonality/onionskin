import { autocompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyField, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, Prec, StateEffect, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  placeholder,
  rectangularSelection,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import {
  continueBlock,
  editorActions,
  listIndent,
  listOutdent,
  pasteLinkHandler,
} from "./commands";
import { codeHighlighting } from "./highlight";
import { docPathFacet, livePreview, sourceModeFacet } from "./livePreview";
import { editorModes, focusModeFacet, typewriterFacet } from "./modes";

export interface EditorSettings {
  sourceMode: boolean;
  focusMode: boolean;
  typewriter: boolean;
  spellcheck: boolean;
}

export interface CaretStats {
  line: number;
  column: number;
  selected: number;
}

interface EditorProps {
  /** Identity of the open document; changing it swaps the editor state. */
  docId: string | null;
  docPath: string | null;
  initialText: string;
  /** Bump to force the buffer to reload from `initialText`. */
  revision: number;
  settings: EditorSettings;
  onChange: (text: string) => void;
  onStats: (stats: CaretStats) => void;
  onReady: (view: EditorView | null) => void;
  onOpenLink: (href: string) => void;
}

interface CachedDoc {
  json: unknown;
  scrollTop: number;
}

const fields = { history: historyField };

export function Editor(props: EditorProps) {
  const { docId, docPath, initialText, revision, settings } = props;

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cacheRef = useRef(new Map<string, CachedDoc>());
  const currentIdRef = useRef<string | null>(null);

  // Callbacks change every render; keep the extensions stable by reading them
  // through a ref instead of rebuilding the editor.
  const handlers = useRef(props);
  handlers.current = props;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const docPathRef = useRef(docPath);
  docPathRef.current = docPath;

  const buildExtensions = (): Extension => {
    const s = settingsRef.current;
    return [
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      highlightSpecialChars(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ activateOnTyping: false }),
      highlightSelectionMatches(),
      search({ top: true }),
      EditorView.lineWrapping,
      placeholder("Write something…"),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        addKeymap: false,
      }),
      codeHighlighting,
      livePreview(),
      editorModes(),
      docPathFacet.of(docPathRef.current),
      sourceModeFacet.of(s.sourceMode),
      focusModeFacet.of(s.focusMode),
      typewriterFacet.of(s.typewriter),
      EditorView.contentAttributes.of({
        spellcheck: s.spellcheck ? "true" : "false",
        autocorrect: "on",
        autocapitalize: "sentences",
      }),
      pasteLinkHandler,
      EditorView.domEventHandlers({
        mousedown(event, view) {
          const target = event.target as HTMLElement | null;
          const anchor = target?.closest?.("[data-href]") as HTMLElement | null;
          if (!anchor) return false;
          if (!(event.metaKey || event.ctrlKey)) return false;
          event.preventDefault();
          const href = anchor.getAttribute("data-href");
          if (href) handlers.current.onOpenLink(href);
          void view;
          return true;
        },
      }),
      Prec.high(
        keymap.of([
          { key: "Enter", run: continueBlock },
          { key: "Tab", run: listIndent, shift: listOutdent },
          { key: "Mod-b", run: editorActions.bold },
          { key: "Mod-i", run: editorActions.italic },
          { key: "Mod-e", run: editorActions["inline-code"] },
          { key: "Mod-l", run: editorActions.link },
          { key: "Mod-Shift-x", run: editorActions.strike },
          { key: "Mod-Shift-h", run: editorActions.highlight },
          { key: "Mod-Shift-q", run: editorActions.quote },
          { key: "Mod-Shift-k", run: editorActions["code-block"] },
          { key: "Mod-Shift-r", run: editorActions.hr },
          { key: "Mod-Shift-t", run: editorActions.table },
          { key: "Mod-Shift-8", run: editorActions["list-bullet"] },
          { key: "Mod-Shift-9", run: editorActions["list-ordered"] },
          { key: "Mod-Shift-0", run: editorActions["list-task"] },
          { key: "Mod-Enter", run: editorActions["toggle-task"] },
          { key: "Mod-1", run: editorActions.h1 },
          { key: "Mod-2", run: editorActions.h2 },
          { key: "Mod-3", run: editorActions.h3 },
          { key: "Mod-4", run: editorActions.h4 },
          { key: "Mod-5", run: editorActions.h5 },
          { key: "Mod-6", run: editorActions.h6 },
          { key: "Mod-0", run: editorActions.paragraph },
          // CodeMirror's default binding inserts a comment here; the window
          // handler owns this key for toggling source mode.
          { key: "Mod-/", run: () => true },
        ]),
      ),
      keymap.of([...closeBracketsKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          handlers.current.onChange(update.state.doc.toString());
        }
        if (update.docChanged || update.selectionSet) {
          const range = update.state.selection.main;
          const line = update.state.doc.lineAt(range.head);
          handlers.current.onStats({
            line: line.number,
            column: range.head - line.from + 1,
            selected: update.state.selection.ranges.reduce(
              (sum, r) => sum + (r.to - r.from),
              0,
            ),
          });
        }
      }),
    ];
  };

  /** Saves the live buffer so returning to this tab restores it exactly. */
  const cacheCurrent = (view: EditorView) => {
    const id = currentIdRef.current;
    if (!id) return;
    cacheRef.current.set(id, {
      json: view.state.toJSON(fields),
      scrollTop: view.scrollDOM.scrollTop,
    });
  };

  /**
   * Swaps the buffer, preserving undo history and scroll position for
   * documents we have seen before in this session.
   */
  const applyDoc = (view: EditorView, id: string | null, text: string, force = false) => {
    const previousId = currentIdRef.current;
    if (previousId === id && !force) return;

    // Reloaded from disk: throw away the stale buffer and its history.
    if (force && id) cacheRef.current.delete(id);

    // Saving an untitled buffer renames its id. Same buffer, new name — keep
    // the live state so the first save does not wipe the undo history.
    if (
      id &&
      previousId?.startsWith("untitled:") &&
      !cacheRef.current.has(id) &&
      view.state.doc.toString() === text
    ) {
      currentIdRef.current = id;
      return;
    }

    cacheCurrent(view);
    currentIdRef.current = id;

    if (!id) {
      view.setState(EditorState.create({ doc: "", extensions: buildExtensions() }));
      return;
    }

    const cached = cacheRef.current.get(id);
    let state: EditorState | null = null;

    if (cached) {
      try {
        const restored = EditorState.fromJSON(
          cached.json as Parameters<typeof EditorState.fromJSON>[0],
          { extensions: buildExtensions() },
          fields,
        );
        // A mismatch means the file was reloaded from disk underneath us.
        if (restored.doc.toString() === text) state = restored;
      } catch {
        state = null;
      }
    }

    if (!state) state = EditorState.create({ doc: text, extensions: buildExtensions() });

    view.setState(state);
    if (cached) view.scrollDOM.scrollTop = cached.scrollTop;
  };

  // Create the view once, then hand it the current document.
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      state: EditorState.create({ doc: "", extensions: buildExtensions() }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    currentIdRef.current = null;
    applyDoc(view, handlers.current.docId, handlers.current.initialText);
    handlers.current.onReady(view);

    return () => {
      cacheCurrent(view);
      currentIdRef.current = null;
      handlers.current.onReady(null);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revisionRef = useRef(revision);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const reloaded = revisionRef.current !== revision;
    revisionRef.current = revision;
    applyDoc(view, docId, initialText, reloaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, revision]);

  // Live settings changes reconfigure the running editor in place.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: StateEffect.reconfigure.of(buildExtensions()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.sourceMode,
    settings.focusMode,
    settings.typewriter,
    settings.spellcheck,
    docPath,
  ]);

  return <div className="editor-host" ref={hostRef} />;
}
