import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Loading the app must not reach any other domain: fonts, styles and scripts are served by the app itself.
// Links people click (an <a href>) are fine; resources the browser fetches on its own are not.
// Files are read from disk: Vitest empties stylesheets, even imported with ?raw.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const sources = Object.keys(import.meta.glob("./**/*.{css,svelte}")).map((file) => [file, read(file)] as const);

const REMOTE = /^(https?:)?\/\//i;

function fetchedUrls(text: string): string[] {
  const urls: string[] = [];
  for (const m of text.matchAll(/<(?:link|script|img|iframe|source|video|audio)\b[^>]*?\s(?:src|href|srcset)="([^"]+)"/gi)) urls.push(m[1]);
  for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)/gi)) urls.push(m[1]);
  for (const m of text.matchAll(/@import\s+(?:url\()?\s*['"]?([^'");\s]+)/gi)) urls.push(m[1]);
  return urls;
}

describe("third-party requests", () => {
  it("index.html loads nothing from another domain", () => {
    expect(fetchedUrls(read("../index.html")).filter((u) => REMOTE.test(u))).toEqual([]);
  });

  it("styles and components load nothing from another domain", () => {
    expect(sources.length).toBeGreaterThan(10);
    const remote = sources.flatMap(([file, text]) => fetchedUrls(text).filter((u) => REMOTE.test(u)).map((u) => `${file}: ${u}`));
    expect(remote).toEqual([]);
  });

  it("serves Inter from the app's own files", () => {
    expect(fetchedUrls(read("./assets/fonts/fonts.css"))).toEqual(["./inter-latin-ext.woff2", "./inter-latin.woff2"]);
    expect(read("./app.css")).toMatch(/--font:[^;]*\bInter\b/);
  });
});
