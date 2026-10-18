/** Dates of the calendar view, as local days (YYYY-MM-DD); weeks start on Monday. */
import { intlLocale } from "./i18n.svelte";

const parse = (day: string) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)));
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (day: string, n: number) => {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/** Monday of the week holding `day`. */
export const weekStart = (day: string) => addDays(day, -((parse(day).getUTCDay() + 6) % 7));

/** The seven days of the week holding `day`. */
export const weekOf = (day: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i));

/** The weeks shown for the month holding `day`: from the Monday before the 1st to the Sunday after its last day. */
export function monthGrid(day: string): string[][] {
  const first = `${day.slice(0, 7)}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const weeks: string[][] = [];
  for (let d = weekStart(first); d <= last; d = addDays(d, 7)) weeks.push(weekOf(d));
  return weeks;
}

/** The same day `n` months later (the last day of shorter months). */
export function addMonths(day: string, n: number): string {
  const d = parse(day);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const days = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), days));
  return iso(target);
}

const format = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(intlLocale(), { ...options, timeZone: "UTC" }).format(parse(day));

/** "October 2026". */
export const monthTitle = (day: string) => format(day, { month: "long", year: "numeric" });
/** "Mon", "Tue"… */
export const weekdayShort = (day: string) => format(day, { weekday: "short" });
/** "Mon 19 Oct". */
export const dayTitle = (day: string) => format(day, { weekday: "short", day: "numeric", month: "short" });
