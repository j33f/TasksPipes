/** Recurring tasks, in words: "Every 2 weeks on Monday, Thursday", "On the first Monday of every month"… */
import { prefs, t } from "./i18n.svelte";
import type { Recurrence } from "./types";

type Rule = Recurrence["rule"];

/** The name of an ISO weekday (1 = Monday), in the page's language. */
export const weekdayName = (d: number, style: "long" | "short" = "long") =>
  new Intl.DateTimeFormat(prefs.lang, { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, d))); // 1 January 2024 was a Monday

const nthName = (nth: number) =>
  nth === 1 ? t("first") : nth === 2 ? t("second") : nth === 3 ? t("third") : nth === 4 ? t("fourth") : t("last");

const dayMonth = (day: string) =>
  new Intl.DateTimeFormat(prefs.lang, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

/** A rule in words; `start` gives the yearly date. */
export function describeRule(rule: Rule, start: string): string {
  const n = rule.interval;
  switch (rule.freq) {
    case "daily":
      return n === 1 ? t("Every day") : t("Every {n} days", { n });
    case "weekly": {
      const days = (rule.weekdays ?? []).map((d) => weekdayName(d)).join(", ");
      return n === 1 ? t("Every week on {days}", { days }) : t("Every {n} weeks on {days}", { n, days });
    }
    case "monthly": {
      const m = rule.monthly ?? { kind: "day", day: Number(start.slice(8, 10)) };
      if (m.kind === "day") return n === 1 ? t("Every month on day {day}", { day: m.day }) : t("Every {n} months on day {day}", { n, day: m.day });
      if (m.kind === "lastBusinessDay") return n === 1 ? t("On the last business day of every month") : t("On the last business day, every {n} months", { n });
      const what = { nth: nthName(m.nth), weekday: weekdayName(m.weekday) };
      return n === 1 ? t("On the {nth} {weekday} of every month", what) : t("On the {nth} {weekday}, every {n} months", { ...what, n });
    }
    case "yearly":
      return n === 1 ? t("Every year on {date}", { date: dayMonth(start) }) : t("Every {n} years on {date}", { n, date: dayMonth(start) });
  }
}
