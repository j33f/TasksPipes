/** Estimates and logged time: typed as "2h30", "1.5" (hours), "45min"; shown in hours, never in days. */
import { t } from "./i18n.svelte";

/** Minutes from what one types, or null if it does not read as a duration. */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase().replace(",", ".").replace(/\s+/g, "");
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+(?:\.\d+)?)h?$/))) return Math.round(Number(m[1]) * 60) || null;
  if ((m = s.match(/^(\d+)h(\d{1,2})(?:m|min)?$/))) return Number(m[1]) * 60 + Number(m[2]) || null;
  if ((m = s.match(/^(\d+)(?:m|min|mn)$/))) return Number(m[1]) || null;
  return null;
}

/** "45 min", "2 h", "26 h 30". */
export function formatWork(minutes: number): string {
  if (minutes < 60) return t("{n} min", { n: minutes });
  const h = Math.floor(minutes / 60);
  return minutes % 60 ? t("{h} h {m}", { h, m: String(minutes % 60).padStart(2, "0") }) : t("{h} h", { h });
}

/** "2 h 30" back into what one would type: "2h30". */
export const durationInput = (minutes: number | null) => (minutes ? `${Math.floor(minutes / 60)}h${minutes % 60 ? String(minutes % 60).padStart(2, "0") : ""}` : "");
