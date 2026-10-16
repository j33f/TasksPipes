/**
 * Translations of the web app. Texts are written in English in the code and wrapped in t();
 * locales/fr.ts holds their French version. The language is the one chosen in the profile,
 * else the browser's.
 */
import { FR } from "./locales/fr";

export type Locale = "en" | "fr";
export type Theme = "light" | "dark";

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
];

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

function detect(): Locale {
  for (const l of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const tag = (l || "").slice(0, 2).toLowerCase();
    if (tag === "fr" || tag === "en") return tag;
  }
  return "en";
}

const asLocale = (v: unknown): Locale | null => (v === "en" || v === "fr" ? v : null);
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
  const s = prefs.lang === "fr" ? (FR[msg] ?? msg) : msg;
  return params ? s.replace(/\{(\w+)\}/g, (all, k: string) => (k in params ? String(params[k]) : all)) : s;
}

/** Singular or plural form for `n` (French counts 0 as singular), with {n} filled. */
export function tn(n: number, one: string, other: string, params?: Record<string, string | number>): string {
  const form = new Intl.PluralRules(prefs.lang).select(n) === "one" ? one : other;
  return t(form, { n, ...params });
}

/** BCP 47 tag for Intl formatting. */
export const intlLocale = () => (prefs.lang === "fr" ? "fr-FR" : "en-GB");
