/**
 * CSV (RFC 4180) without a dependency: reading with quoted fields and line breaks, the separator guessed from the
 * header line; writing with a byte order mark (spreadsheets then read UTF-8) and cells that a spreadsheet would run
 * as formulas neutralised.
 */

const SEPARATORS = [",", ";", "\t"] as const;
export type Separator = (typeof SEPARATORS)[number];

/** The separator used by the header line: the one found most often outside quotes. */
export function guessSeparator(text: string): Separator {
  const line = text.slice(0, text.search(/\r?\n|$/));
  const counts = new Map<Separator, number>(SEPARATORS.map((s) => [s, 0]));
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && counts.has(c as Separator)) counts.set(c as Separator, counts.get(c as Separator)! + 1);
  }
  const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return n ? best : ",";
}

/**
 * Rows of a CSV text, each a list of cells. Empty lines are kept (as empty rows), so that rows are numbered as a
 * spreadsheet shows them; only the end of the file is trimmed.
 */
export function parseCsv(text: string, sep: Separator = guessSeparator(text)): string[][] {
  const s = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  while (rows.length && rows[rows.length - 1].every((x) => x === "")) rows.pop();
  return rows;
}

/** One cell: quoted when needed; a value a spreadsheet would run as a formula starts with a quote mark instead. */
export function csvCell(value: unknown, sep: Separator = ","): string {
  let v = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return v.includes(sep) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** A whole file, with a byte order mark and CRLF line ends. */
export const toCsv = (rows: unknown[][], sep: Separator = ",") =>
  "\uFEFF" + rows.map((r) => r.map((c) => csvCell(c, sep)).join(sep)).join("\r\n") + "\r\n";
