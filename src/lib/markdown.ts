import DOMPurify from "dompurify";
import katex from "katex";
import { Marked } from "marked";
import { assetUrl } from "./ipc";
import { dirname, isAbsolute, join } from "./path";

const marked = new Marked({
  gfm: true,
  breaks: false,
  pedantic: false,
});

/** Renders a markdown block to sanitised HTML. */
export function renderMarkdown(source: string): string {
  const raw = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(raw, { ADD_ATTR: ["target", "align", "colspan", "rowspan"] });
}

/** Renders a single line/span of markdown without wrapping it in a paragraph. */
export function renderInlineMarkdown(source: string): string {
  const raw = marked.parseInline(source, { async: false }) as string;
  return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
}

/** Resolves an image/link reference against the document's own folder. */
export function resolveResource(src: string, docPath: string | null): string {
  if (!src) return src;
  if (/^(https?:|data:|blob:|mailto:|asset:|tauri:)/i.test(src)) return src;

  let p = src;
  if (p.startsWith("file://")) {
    // `file:///C:/x` -> `C:/x`, `file:///home/x` -> `/home/x`
    p = p.slice("file://".length);
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    try {
      p = decodeURI(p);
    } catch {
      /* leave the raw path in place */
    }
  }
  if (!isAbsolute(p)) {
    if (!docPath) return src;
    p = join(dirname(docPath), decodeURIComponent(p));
  }
  return assetUrl(p);
}

// Deliberately lookbehind-free: older WebKit builds fail to parse those.
const MATH_INLINE = /\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$/g;
const HIGHLIGHT = /==([^=\n]+)==/g;

function renderTex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: "html",
      strict: false,
      trust: false,
    });
  } catch {
    return "";
  }
}

/** Walks text nodes outside code, upgrading `$math$` and `==marks==` in place. */
function enrichTextNodes(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement;
      while (el && el !== root) {
        const tag = el.tagName;
        if (tag === "CODE" || tag === "PRE" || tag === "SCRIPT" || tag === "STYLE") {
          return NodeFilter.FILTER_REJECT;
        }
        el = el.parentElement;
      }
      return /[$=]/.test(node.nodeValue ?? "")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const targets: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    targets.push(current as Text);
    current = walker.nextNode();
  }

  for (const node of targets) {
    const text = node.nodeValue ?? "";
    let html = text
      .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string)
      .replace(MATH_INLINE, (_m, tex: string) => renderTex(tex, false) || _m)
      .replace(HIGHLIGHT, (_m, inner: string) => `<mark>${inner}</mark>`);

    if (html === text) continue;
    const holder = document.createElement("span");
    holder.innerHTML = html;
    node.replaceWith(...Array.from(holder.childNodes));
  }
}

export interface HydrateOptions {
  /** Path of the document the HTML came from, used to resolve relative links. */
  docPath: string | null;
  /** When true, `$...$` and `==...==` are upgraded. */
  enrich?: boolean;
}

/**
 * Post-processes rendered markdown in the DOM: rewrites local resource URLs so
 * the webview can load them, and renders math and highlight marks.
 */
export function hydrateRendered(root: HTMLElement, opts: HydrateOptions) {
  root.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (src) img.setAttribute("src", resolveResource(src, opts.docPath));
    img.setAttribute("loading", "lazy");
  });

  root.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) {
      a.setAttribute("data-external", "true");
      a.setAttribute("rel", "noreferrer noopener");
    }
  });

  root.querySelectorAll("pre > code").forEach((code) => {
    const cls = code.getAttribute("class") ?? "";
    const lang = /language-([\w+-]+)/.exec(cls)?.[1];
    if (lang) code.parentElement?.setAttribute("data-lang", lang);
  });

  if (opts.enrich !== false) {
    // Display math is its own paragraph; handle it before inline scanning.
    root.querySelectorAll("p").forEach((p) => {
      const m = /^\s*\$\$([\s\S]+?)\$\$\s*$/.exec(p.textContent ?? "");
      if (!m) return;
      const div = document.createElement("div");
      div.className = "math-display";
      div.innerHTML = renderTex(m[1], true);
      p.replaceWith(div);
    });
    enrichTextNodes(root);
  }
}

/** Renders `$$...$$` / `$...$` to KaTeX HTML for editor widgets. */
export function renderMath(tex: string, display: boolean): string {
  return renderTex(tex, display);
}
