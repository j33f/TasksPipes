/** Dates and wall-clock times in a time zone (reports are due at a local hour, summer time included). */

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
  weekday: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(date: Date, tz: string): Parts {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23", weekday: "short",
    });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, weekday: p.weekday };
}

/** Offset of a time zone at an instant, in milliseconds (Paris in summer: +2 h). */
function offset(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant at which it is `hour`:00 on `day` (YYYY-MM-DD) in a time zone. */
export function zonedInstant(day: string, hour: number, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour);
  // Correct the guess by the offset, twice to land right around summer time changes.
  let t = wall - offset(new Date(wall), tz);
  t = wall - offset(new Date(t), tz);
  return new Date(t);
}

/** Local date (YYYY-MM-DD) of an instant in a time zone. */
export function localDay(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export interface Period {
  start: Date;
  end: Date;
}

/** A day's activity: from the day before at `hour` to the day at `hour`. */
export const dailyPeriod = (day: string, hour: number, tz: string): Period => ({
  start: zonedInstant(addDays(day, -1), hour, tz),
  end: zonedInstant(day, hour, tz),
});

/** A week ending on `day` at `hour`. */
export const weeklyPeriod = (day: string, hour: number, tz: string): Period => ({
  start: zonedInstant(addDays(day, -7), hour, tz),
  end: zonedInstant(day, hour, tz),
});

/** The latest day, on or before `day`, that is the given weekday (0 = Sunday… 5 = Friday). */
export function lastWeekday(day: string, weekday: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() - weekday + 7) % 7;
  return addDays(day, -back);
}
