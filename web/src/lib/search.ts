/** Global search (GET /api/search): excerpts mark the matched words between two control characters. */
const MARK = /\u0002([^\u0003]*)\u0003/g;

/** An excerpt as pieces of text, matched ones flagged: shown as text nodes, never as HTML. */
export function highlight(snippet: string): { text: string; mark: boolean }[] {
  const parts: { text: string; mark: boolean }[] = [];
  let last = 0;
  for (const m of snippet.matchAll(MARK)) {
    if (m.index > last) parts.push({ text: snippet.slice(last, m.index), mark: false });
    parts.push({ text: m[1], mark: true });
    last = m.index + m[0].length;
  }
  const rest = snippet.slice(last).replace(/[\u0002\u0003]/g, "");
  if (rest) parts.push({ text: rest, mark: false });
  return parts;
}

/** Whether a key press opens the search: Ctrl + K, or ⌘ + K on a Mac. */
export const isSearchShortcut = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
