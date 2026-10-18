/**
 * Every text of the web app has its French version (locales/fr.json, "web"), and the dictionary holds no stale
 * entry. Other languages may lack texts (shown in English), but hold no stale one and keep the placeholders.
 * Texts are found in the sources: t("…"), tn(n, "…", "…"), and the label lists shown with t().
 */
import { describe, expect, it } from "vitest";
import { LOCALE_FILES } from "./i18n.svelte";
import { FIELD_TYPE_LABELS, STATUSES } from "./constants";
import { GROUPS } from "./gtd";
import { GIT_STATE_LABEL } from "./git";
import { GIT_ACTIONS } from "./events";
import { PRIORITIES } from "./labels";

const FR = LOCALE_FILES.fr.web ?? {};

// Every source file of the app, as text (tests left out).
const sources = import.meta.glob<string>(["../**/*.{ts,svelte}", "!../**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** String literals passed to t() and tn() (both forms of tn). */
function textsIn(code: string): string[] {
  const lit = String.raw`"((?:[^"\\]|\\.)*)"`;
  const found: string[] = [];
  for (const m of code.matchAll(new RegExp(String.raw`\bt\(\s*${lit}`, "g"))) found.push(m[1]);
  for (const m of code.matchAll(new RegExp(String.raw`\btn\([^,]+,\s*${lit},\s*${lit}`, "g"))) found.push(m[1], m[2]);
  // Literals chosen between in t(cond ? "a" : "b").
  for (const m of code.matchAll(new RegExp(String.raw`\bt\(\s*[\w.?]+\s*\?\s*${lit}\s*:\s*${lit}`, "g"))) found.push(m[1], m[2]);
  return found.map((s) => JSON.parse(`"${s}"`));
}

const names = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
/** Translations whose placeholders differ from the English text's (a singular form may leave out {n}). */
const brokenPlaceholders = (dict: Record<string, string>) => Object.entries(dict).filter(([en, tr]) => names(en).join() !== names(tr).join()
  && !(names(en).includes("n") && names(tr).join() === names(en).filter((x) => x !== "n").join()));

const used = new Set<string>([
  ...Object.values(sources).flatMap(textsIn),
  // Lists of labels shown with t().
  ...STATUSES.map((s) => s.label),
  ...Object.values(FIELD_TYPE_LABELS),
  ...GROUPS.flatMap((g) => [g.label, g.hint]),
  ...Object.values(GIT_STATE_LABEL),
  ...Object.values(GIT_ACTIONS),
  ...PRIORITIES.map((p) => p.label),
  // Theme choices (AccountModal: t(label) over a literal list).
  "Automatic", "Light", "Dark",
]);

describe("French dictionary", () => {
  it("translates every text of the app", () => {
    expect(used.size).toBeGreaterThan(400); // the extraction found the texts
    const missing = [...used].filter((s) => !(s in FR));
    expect(missing).toEqual([]);
  });

  it("has no stale entry", () => {
    const stale = Object.keys(FR).filter((k) => !used.has(k));
    expect(stale).toEqual([]);
  });

  it("keeps the placeholders of each text", () => {
    expect(brokenPlaceholders(FR)).toEqual([]);
  });

  it("is written in French typography", () => {
    // A space before ? ! : ; (French rule), and « » rather than straight or English quotes.
    const text = (fr: string) => fr.replace(/https?:\/\/\S+/g, "").replace(/\{\w+\}/g, "x");
    const bad = Object.entries(FR).filter(([, fr]) => /[^\s\u00a0\u202f][?!;:]/.test(text(fr)) || /["“”]/.test(text(fr)));
    expect(bad).toEqual([]);
  });
});

describe("other languages", () => {
  for (const [code, file] of Object.entries(LOCALE_FILES).filter(([c]) => c !== "en" && c !== "fr")) {
    it(`${code}: keeps the placeholders, holds no stale entry, and tells what is left to translate`, () => {
      const web = file.web ?? {};
      expect(file.name).toBeTruthy();
      expect(Object.keys(web).filter((k) => !used.has(k))).toEqual([]);
      expect(brokenPlaceholders(web)).toEqual([]);
      const missing = [...used].filter((s) => !(s in web)).length;
      if (missing) console.warn(`locales/${code}.json: ${missing} texts of the app shown in English`);
    });
  }
});
