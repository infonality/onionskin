import katexCss from "katex/dist/katex.min.css?inline";
import { hydrateRendered, renderMarkdown } from "./markdown";
import { stem } from "./path";

/**
 * Renders markdown to a finished HTML fragment, running the same hydration the
 * editor uses so math, highlights and local images all survive the trip.
 */
export function renderDocumentFragment(source: string, docPath: string | null): string {
  const holder = document.createElement("div");
  holder.innerHTML = renderMarkdown(source);
  hydrateRendered(holder, { docPath });

  // Task list checkboxes are read-only in exported output.
  holder.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((box) => {
    box.setAttribute("disabled", "");
  });
  return holder.innerHTML;
}

/** Renders markdown and returns just its text, for "paste as plain text". */
export function stripMarkdown(source: string): string {
  const holder = document.createElement("div");
  holder.innerHTML = renderDocumentFragment(source, null);
  return (holder.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

const DOCUMENT_CSS = `
:root {
  --ink: #24292f;
  --muted: #6a737d;
  --rule: #d8dee4;
  --accent: #3b5bdb;
  --code-bg: #f6f8fa;
  --quote-bg: #f8f9fb;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #d7dce3;
    --muted: #8b949e;
    --rule: #30363d;
    --accent: #7d9bff;
    --code-bg: #161b22;
    --quote-bg: #14181e;
  }
  body { background: #0d1117; }
}
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  padding: 56px 28px 96px;
  max-width: 46rem;
  color: var(--ink);
  font: 16px/1.72 ui-serif, Georgia, "Iowan Old Style", "Source Serif Pro", serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
h1, h2, h3, h4, h5, h6 {
  font-family: ui-sans-serif, -apple-system, "Segoe UI", Inter, system-ui, sans-serif;
  line-height: 1.28;
  margin: 2em 0 0.6em;
  font-weight: 650;
  letter-spacing: -0.011em;
}
h1 { font-size: 2.05em; margin-top: 0; letter-spacing: -0.02em; }
h2 { font-size: 1.55em; }
h3 { font-size: 1.26em; }
h4 { font-size: 1.08em; }
h5, h6 { font-size: 1em; color: var(--muted); }
p, ul, ol, blockquote, pre, table { margin: 0 0 1.1em; }
a { color: var(--accent); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); }
ul, ol { padding-left: 1.5em; }
li { margin: 0.25em 0; }
li > input[type=checkbox] { margin-right: 0.5em; }
blockquote {
  margin-left: 0;
  padding: 0.6em 1.1em;
  border-left: 3px solid var(--rule);
  background: var(--quote-bg);
  border-radius: 0 6px 6px 0;
  color: var(--muted);
}
blockquote > :last-child { margin-bottom: 0; }
code {
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 0.88em;
  background: var(--code-bg);
  padding: 0.15em 0.38em;
  border-radius: 4px;
}
pre {
  background: var(--code-bg);
  padding: 1em 1.15em;
  border-radius: 8px;
  overflow-x: auto;
  border: 1px solid var(--rule);
}
pre code { background: none; padding: 0; font-size: 0.86em; line-height: 1.6; }
table { border-collapse: collapse; width: 100%; font-size: 0.95em; }
th, td { border: 1px solid var(--rule); padding: 0.5em 0.75em; text-align: left; }
th { background: var(--code-bg); font-weight: 640; }
img { max-width: 100%; height: auto; border-radius: 6px; }
hr { border: 0; border-top: 1px solid var(--rule); margin: 2.4em 0; }
mark { background: #fff3a3; color: inherit; padding: 0 0.15em; border-radius: 3px; }
kbd {
  font-family: ui-monospace, monospace; font-size: 0.82em;
  border: 1px solid var(--rule); border-bottom-width: 2px;
  border-radius: 4px; padding: 0.1em 0.4em; background: var(--code-bg);
}
.math-display { margin: 1.4em 0; text-align: center; overflow-x: auto; }
@media print {
  body { padding: 0; max-width: none; font-size: 11.5pt; }
  pre, blockquote, table, img { break-inside: avoid; }
  h1, h2, h3, h4 { break-after: avoid; }
  a { color: inherit; border-bottom: none; }
}
`;

/** Wraps a rendered fragment in a self-contained HTML file. */
export function buildStandaloneHtml(title: string, fragment: string): string {
  const safeTitle = stem(title).replace(/[<>&]/g, "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Lumen">
<title>${safeTitle}</title>
<style>${katexCss}</style>
<style>${DOCUMENT_CSS}</style>
</head>
<body>
${fragment}
</body>
</html>
`;
}
