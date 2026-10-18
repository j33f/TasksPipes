/**
 * Translations of the web app. Texts are written in English in the code and wrapped in t(); each language has its
 * file in the repository's locales/ folder (<code>.json, see docs/TRANSLATION.md), bundled at build: its "web" part
 * translates the app. What a file lacks shows in English. The language is the one chosen in the profile, else the
 * browser's.
 */

/** A language code, the name of a file of locales/ ("en", "fr", "es"…). */
export type Locale = string;
export type Theme = "light" | "dark";

interface LocaleFile {
  name: string;
  intl: string;
  web?: Record<string, string>;
}

const files = import.meta.glob<LocaleFile>("../../../locales/*.json", { eager: true, import: "default" });
/** The language files, by code. */
export const LOCALE_FILES: Record<Locale, LocaleFile> = Object.fromEntries(
  Object.entries(files).map(([path, file]) => [path.split("/").pop()!.replace(/\.json$/, ""), file])
);

/** The languages offered, by their own name, English first. */
export const LOCALES: { id: Locale; label: string }[] = Object.entries(LOCALE_FILES)
  .map(([id, f]) => ({ id, label: f.name }))
  .sort((a, b) => (a.id === "en" ? -1 : b.id === "en" ? 1 : a.label.localeCompare(b.label)));

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
};

const known = (v: unknown): v is string => typeof v === "string" && Object.hasOwn(LOCALE_FILES, v);

function detect(): Locale {
  for (const l of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    if (known(l)) return l;
    const tag = String(l || "").slice(0, 2).toLowerCase();
    if (known(tag)) return tag;
  }
  return "en";
}

const asLocale = (v: unknown): Locale | null => (known(v) ? v : null);
const asTheme = (v: unknown): Theme | null => (v === "light" || v === "dark" ? v : null);

/** Language and theme: chosen ones are kept in the profile and, for the login page, in this browser. */
class Prefs {
  /** Chosen language; null follows the browser. */
  locale = $state<Locale | null>(asLocale(read("tp:locale")));
  /** Chosen theme; null follows the system. */
  theme = $state<Theme | null>(asTheme(read("tp:theme")));
  lang = $derived<Locale>(this.locale ?? detect());

  set(next: { locale?: Locale | null; theme?: Theme | null }) {
    if ("locale" in next) {
      this.locale = asLocale(next.locale);
      store("tp:locale", this.locale);
    }
    if ("theme" in next) {
      this.theme = asTheme(next.theme);
      store("tp:theme", this.theme);
    }
  }
}

export const prefs = new Prefs();

/** Translates a text and fills its "{name}" placeholders. */
export function t(msg: string, params?: Record<string, string | number>): string {
  const s = LOCALE_FILES[prefs.lang]?.web?.[msg] ?? msg;
  return params ? s.replace(/\{(\w+)\}/g, (all, k: string) => (k in params ? String(params[k]) : all)) : s;
}

/** Singular or plural form for `n`, following the language's rules (French counts 0 as singular), with {n} filled. */
export function tn(n: number, one: string, other: string, params?: Record<string, string | number>): string {
  const form = new Intl.PluralRules(prefs.lang).select(n) === "one" ? one : other;
  return t(form, { n, ...params });
}

/** BCP 47 tag for Intl formatting. */
export const intlLocale = () => LOCALE_FILES[prefs.lang]?.intl ?? prefs.lang;
