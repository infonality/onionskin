/** Tiny cross-platform path helpers (paths may use `/` or `\`). */

const SEP_RE = /[\\/]/;

export function isAbsolute(p: string): boolean {
  return /^([a-zA-Z]:[\\/]|[\\/])/.test(p);
}

export function isWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.includes("\\");
}

export function sep(p: string): string {
  return isWindowsPath(p) ? "\\" : "/";
}

export function basename(p: string): string {
  const parts = p.split(SEP_RE).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

export function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (idx <= 0) return idx === 0 ? p.slice(0, 1) : "";
  return p.slice(0, idx);
}

export function extname(p: string): string {
  const base = basename(p);
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(idx + 1).toLowerCase() : "";
}

/** Strips the extension: `notes/todo.md` -> `todo`. */
export function stem(p: string): string {
  const base = basename(p);
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(0, idx) : base;
}

/** Joins and normalises, resolving `.` and `..` segments. */
export function join(base: string, ...rest: string[]): string {
  const s = sep(base);
  const segments = [base, ...rest].join("/").split(SEP_RE);
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "." || seg === "") {
      // Preserve a leading empty segment so POSIX roots stay absolute.
      if (out.length === 0 && seg === "") out.push("");
      continue;
    }
    if (seg === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
      continue;
    }
    out.push(seg);
  }
  return out.join(s) || s;
}

/**
 * Expresses `target` relative to the directory `from`, falling back to the
 * absolute path when the two live on different roots.
 */
export function relative(from: string, target: string): string {
  const a = from.split(SEP_RE).filter(Boolean);
  const b = target.split(SEP_RE).filter(Boolean);
  const caseless = isWindowsPath(from);
  const same = (x: string, y: string) =>
    caseless ? x.toLowerCase() === y.toLowerCase() : x === y;

  if (!a.length || !b.length || !same(a[0], b[0])) return target;

  let i = 0;
  while (i < a.length && i < b.length && same(a[i], b[i])) i++;
  const ups = a.length - i;
  const rest = b.slice(i);
  if (ups > 4) return target;
  return [...Array(ups).fill(".."), ...rest].join("/") || ".";
}

/** Renders a path for display, shortening the home directory to `~`. */
export function prettyPath(p: string, home: string): string {
  if (home && p.toLowerCase().startsWith(home.toLowerCase())) {
    return "~" + p.slice(home.length);
  }
  return p;
}
