import { describe, expect, it } from "vitest";
import { csvCell, guessSeparator, parseCsv, toCsv } from "./csv.js";

describe("CSV", () => {
  it("reads quoted cells, doubled quotes and line breaks inside cells", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n"two\nlines",z\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "z"]]);
  });

  it("guesses the separator from the header line", () => {
    expect(guessSeparator("Titre;Colonne;Échéance\n1;2;3")).toBe(";");
    expect(guessSeparator("Title\tColumn\nx\ty")).toBe("\t");
    expect(guessSeparator('"a;b",c,d\n')).toBe(",");
    expect(guessSeparator("Title\n")).toBe(",");
    expect(parseCsv("Titre;Colonne\nA;B")).toEqual([["Titre", "Colonne"], ["A", "B"]]);
  });

  it("skips a byte order mark, keeps empty lines in place, and trims the end", () => {
    expect(parseCsv("\uFEFFa,b\n\n1,2\n,\n\n")).toEqual([["a", "b"], [""], ["1", "2"]]);
  });

  it("writes what it reads back", () => {
    const rows = [["Title", "Notes"], ["A, B", 'He said "no"'], ["multi\nline", ""]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(toCsv([["a"]]).startsWith("\uFEFF")).toBe(true);
  });

  it("keeps spreadsheets from running cells as formulas", () => {
    for (const v of ["=1+1", "+33 6", "-2", "@SUM(A1)", "\tx"]) expect(csvCell(v).replace(/^"|"$/g, "").startsWith("'")).toBe(true);
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a;b", ";")).toBe('"a;b"');
  });
});
