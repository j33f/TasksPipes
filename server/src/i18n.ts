/**
 * Server-side translations. Messages are written in English in the code; each language has its file in the
 * repository's locales/ folder (<code>.json, see docs/TRANSLATION.md), read at start: its "server" part translates
 * the messages, its "catalog" part the built-in catalog of pipe and task types, which is written in French (it
 * describes French training centres). What a file lacks shows in English. A request's language comes from the
 * X-Locale header the web app sends, else from Accept-Language, else DEFAULT_LOCALE.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyRequest } from "fastify";
import { config } from "./config.js";
import type { Params } from "./errors.js";
import type { PipeType, TaskType } from "./pipeTypes.js";

/** A language code, the name of a file of locales/ ("en", "fr", "es"…). */
export type Locale = string;
type Dict = Record<string, string>;

export interface LocaleFile {
  /** The language's own name, in the language menu. */
  name: string;
  /** BCP 47 tag for dates and numbers ("fr-FR"). */
  intl: string;
  /** Separator of CSV files for spreadsheets in that language. */
  csvSeparator?: string;
  web?: Dict;
  server?: Dict;
  catalog?: Dict;
}

/** The language the built-in catalog is written in. */
export const CATALOG_SOURCE = "fr";

/** The locales/ folder: next to the built server (dist/), or at the root of the repository (src/). */
function localesDir(): string {
  const candidates = [process.env.LOCALES_DIR, "../locales", "../../locales"].filter(Boolean) as string[];
  for (const c of candidates) {
    const dir = c.startsWith("/") ? c : fileURLToPath(new URL(`${c}/`, import.meta.url));
    if (existsSync(dir)) return dir;
  }
  throw new Error("The locales folder was not found (set LOCALES_DIR)");
}

const dir = localesDir();
export const LOCALE_FILES: Record<Locale, LocaleFile> = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => /^[a-z]{2,3}(-[A-Za-z0-9]+)?\.json$/.test(f))
    .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as LocaleFile])
);
if (!LOCALE_FILES.en) throw new Error("locales/en.json is missing");
/** The languages available, English first. */
export const LOCALES: Locale[] = ["en", ...Object.keys(LOCALE_FILES).filter((l) => l !== "en").sort()];
export const isLocale = (v: unknown): boolean => typeof v === "string" && Object.hasOwn(LOCALE_FILES, v);
// DEFAULT_LOCALE must name an available language.
if (!isLocale(config.defaultLocale)) config.defaultLocale = "en";

/** BCP 47 tag of a language, for Intl. */
export const intlTag = (lang: Locale) => LOCALE_FILES[lang]?.intl ?? lang;
/** CSV separator of a language (spreadsheets in French expect semicolons). */
export const csvSeparator = (lang: Locale) => (LOCALE_FILES[lang]?.csvSeparator === ";" ? ";" : ",");

export function localeOf(req: FastifyRequest): Locale {
  const h = req.headers["x-locale"];
  if (typeof h === "string" && isLocale(h)) return h;
  for (const part of String(req.headers["accept-language"] || "").split(",")) {
    const tag = part.split(";")[0].trim();
    if (isLocale(tag)) return tag;
    if (isLocale(tag.slice(0, 2).toLowerCase())) return tag.slice(0, 2).toLowerCase();
  }
  return config.defaultLocale;
}

/**
 * A word or label in the given language: English UI words and French catalog labels are translated; anything
 * else (names, user text) is left as is. A catalog label a language lacks shows in English.
 */
export function localize(lang: Locale, v: string): string {
  const f = LOCALE_FILES[lang];
  return f?.server?.[v] ?? f?.catalog?.[v] ?? (lang === CATALOG_SOURCE ? v : LOCALE_FILES.en.catalog?.[v] ?? v);
}

/** Translates a message and fills its "{name}" placeholders (known words among the values are translated too). */
export function tr(lang: Locale, msg: string, params?: Params): string {
  const s = LOCALE_FILES[lang]?.server?.[msg] ?? msg;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (all, k: string) =>
    k in params ? (typeof params[k] === "number" ? String(params[k]) : localize(lang, String(params[k]))) : all
  );
}

/**
 * A task type as shown in a language. Select options keep their stored value in `options`
 * and get their display text in `optionLabels`.
 */
export function localizeTaskType(lang: Locale, t: TaskType) {
  const l = (v: string) => localize(lang, v);
  return {
    ...t,
    label: l(t.label),
    description: l(t.description),
    ...(t.group ? { group: l(t.group) } : {}),
    fields: t.fields.map((f) => ({
      ...f,
      label: l(f.label),
      ...(f.hint ? { hint: l(f.hint) } : {}),
      ...(f.options ? { optionLabels: f.options.map(l) } : {}),
    })),
  };
}

export function localizePipeType(lang: Locale, p: PipeType): PipeType {
  const l = (v: string) => localize(lang, v);
  return {
    ...p,
    label: l(p.label),
    group: l(p.group),
    description: l(p.description),
    columns: p.columns.map((c) => ({ ...c, label: l(c.label) })),
    templates: p.templates.map(l),
  };
}
