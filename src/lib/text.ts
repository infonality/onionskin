/** Counts words the way writers expect: CJK glyphs count individually. */
export function countWords(text: string): number {
  const stripped = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");

  const cjk = stripped.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/g);
  const latin = stripped
    .replace(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/g, " ")
    .match(/[A-Za-z0-9À-ÿЀ-ӿ'’-]+/g);

  return (cjk?.length ?? 0) + (latin?.length ?? 0);
}
