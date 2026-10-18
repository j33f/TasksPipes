/**
 * Every message the server can send has its French version (locales/fr.json, "server"), the dictionary holds no
 * stale entry, and the French built-in catalog has its English version (locales/en.json, "catalog"). Other
 * languages may lack entries (shown in English), but hold no stale one and keep the placeholders.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_SOURCE, LOCALE_FILES } from "./i18n.js";

const FR = LOCALE_FILES.fr.server ?? {};
const CATALOG_EN = LOCALE_FILES.en.catalog ?? {};
import { PIPE_TYPES, TASK_TYPES } from "./pipeTypes.js";
import { CUSTOM_GROUP } from "./designer.js";

const lit = String.raw`"((?:[^"\\\n]|\\.)*)"`;
const parse = (s: string) => {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
};
const code = readdirSync(__dirname)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !["i18n.ts", "pipeTypes.ts"].includes(f))
  .map((f) => readFileSync(join(__dirname, f), "utf8"))
  .join("\n");

const patterns = [
  // Messages: errors and translated texts.
  String.raw`\b(?:bad|forbidden|notFound)\(\s*${lit}`,
  String.raw`new (?:HttpError|OutlineError)\(\s*\d+,\s*${lit}`,
  String.raw`\btr\(\s*(?:[\w.]+|localeOf\(req\)),\s*${lit}`,
  // Messages chosen by a condition: bad(cond ? "a" : "b").
  String.raw`\b(?:bad|forbidden|notFound)\(\s*[^;"]*?\?\s*${lit}\s*:\s*${lit}`,
  // Labels put into messages: text(…, "Title"), uuid(…, "Task"), str(…, "Name")…
  String.raw`\b(?:text|uuid|optUuid|str|list|withIds)\([^,()]*(?:\([^()]*\))?[^,()]*,\s*${lit}`,
  // Reminder texts of the calendar, label parameters.
  String.raw`\btext:\s*${lit}`,
  String.raw`\blabel:\s*${lit}`,
];
const used = new Set<string>([CUSTOM_GROUP]);
for (const p of patterns) {
  for (const m of code.matchAll(new RegExp(p, "g"))) for (const s of m.slice(1)) if (s !== undefined) used.add(parse(s));
}
for (const s of [...used]) if (!/[A-Za-z]/.test(s) || /^[a-z]+_[a-z_]+$/.test(s)) used.delete(s);
// Any string literal of the code: an entry nowhere in it is stale.
const literals = new Set([...code.matchAll(new RegExp(lit, "g"))].map((m) => parse(m[1])));

describe("server French dictionary", () => {
  it("translates every message and label", () => {
    expect(used.size).toBeGreaterThan(120); // the extraction found the messages
    expect([...used].filter((s) => !(s in FR))).toEqual([]);
  });

  it("has no stale entry", () => {
    expect(Object.keys(FR).filter((k) => !used.has(k) && !literals.has(k))).toEqual([]);
  });

  it("keeps the placeholders of each message", () => {
    const names = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join();
    expect(Object.entries(FR).filter(([en, fr]) => names(en) !== names(fr))).toEqual([]);
  });

  it("is written in French typography", () => {
    const text = (fr: string) => fr.replace(/https?:\/\/\S*/g, "").replace(/\{\w+\}/g, "x");
    expect(Object.entries(FR).filter(([, fr]) => /[^\s  ][?!;:]/.test(text(fr)) || /["“”]/.test(text(fr)))).toEqual([]);
  });
});

describe("English catalog", () => {
  const strings = new Set<string>();
  for (const t of TASK_TYPES) {
    [t.label, t.description].forEach((s) => strings.add(s));
    for (const f of t.fields) [f.label, f.hint, ...(f.options ?? [])].forEach((s) => s && strings.add(s));
  }
  for (const p of PIPE_TYPES) {
    [p.label, p.group, p.description, ...p.templates, ...p.columns.map((c) => c.label)].forEach((s) => strings.add(s));
  }
  // Names and terms that read the same in English.
  const SAME = new Set(["R&D", 
    "OPCO", "CPF", "France Travail", "Transitions Pro", "Contact", "E-mail", "LinkedIn", "Source", "Type", "Publication", "Facebook",
    "Instagram", "Newsletter", "Forum", "Job dating", "Date", "E-learning", "Document", "Guide", "Intervention", "Module", "Absences",
    "Action", "Session", "Audit", "Commercial", "Prospection", "Communication", "Backlog", "Initial", "Surveillance", "Oral",
    "Post, article, newsletter…", "Syllabus / programme", "Programme", "Satisfaction (/10)", "Corrections", "Documentation",
    "Questionnaire", "Analytics", "Benchmark", "Participants", "Web", "iOS", "Android", "Desktop", "Wireframe", "Prototype", "API",
    "Crowdin", "Lokalise", "Weblate", "Transifex", "User story", "Points", "Bug", "Production", "Version", "Performance", "Validation",
    "Budget", "Notes", "Photos", "Freelance", "Parking", "Transport", "Transaction",
  ]);

  it("translates every label of the built-in types", () => {
    expect([...strings].filter((s) => !(s in CATALOG_EN) && !SAME.has(s))).toEqual([]);
  });

  it("has no entry for labels that no longer exist", () => {
    expect(Object.keys(CATALOG_EN).filter((k) => !strings.has(k) && k !== "Modèles personnalisés")).toEqual([]);
  });
});

describe("other languages", () => {
  const names = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join();
  for (const [code, file] of Object.entries(LOCALE_FILES).filter(([c]) => c !== "en" && c !== "fr")) {
    it(`${code}: keeps the placeholders, holds no stale entry, and tells what is left to translate`, () => {
      expect(file.name, "name").toBeTruthy();
      expect(file.intl, "intl").toBeTruthy();
      const server = file.server ?? {};
      expect(Object.keys(server).filter((k) => !(k in FR))).toEqual([]);
      expect(Object.entries(server).filter(([en, t]) => names(en) !== names(t))).toEqual([]);
      const catalog = file.catalog ?? {};
      expect(Object.keys(catalog).filter((k) => !(k in CATALOG_EN) && !(k in FR))).toEqual([]);
      const missing = Object.keys(FR).filter((k) => !(k in server)).length + Object.keys(CATALOG_EN).filter((k) => !(k in catalog)).length;
      if (missing) console.warn(`locales/${code}.json: ${missing} server or catalog texts shown in English`);
      expect(code).not.toBe(CATALOG_SOURCE);
    });
  }
});
