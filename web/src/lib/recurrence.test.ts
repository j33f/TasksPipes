import { afterEach, describe, expect, it } from "vitest";
import { describeRule, weekdayName } from "./recurrence";
import { prefs } from "./i18n.svelte";

afterEach(() => prefs.set({ locale: "en", theme: null }));

describe("repetitions in words", () => {
  it("name every kind of rule", () => {
    prefs.set({ locale: "en", theme: null });
    expect(describeRule({ freq: "daily", interval: 1 }, "2026-10-19")).toBe("Every day");
    expect(describeRule({ freq: "weekly", interval: 2, weekdays: [1, 4] }, "2026-10-19")).toBe("Every 2 weeks on Monday, Thursday");
    expect(describeRule({ freq: "monthly", interval: 1, monthly: { kind: "day", day: 10 } }, "2026-10-10")).toBe("Every month on day 10");
    expect(describeRule({ freq: "monthly", interval: 1, monthly: { kind: "weekday", nth: 1, weekday: 1 } }, "2026-10-05")).toBe("On the first Monday of every month");
    expect(describeRule({ freq: "monthly", interval: 3, monthly: { kind: "lastBusinessDay" } }, "2026-10-30")).toBe("On the last business day, every 3 months");
    expect(describeRule({ freq: "yearly", interval: 1 }, "2026-03-15")).toBe("Every year on March 15");
  });

  it("speak French", () => {
    prefs.set({ locale: "fr", theme: null });
    expect(weekdayName(1)).toBe("lundi");
    expect(describeRule({ freq: "monthly", interval: 1, monthly: { kind: "weekday", nth: -1, weekday: 5 } }, "2026-10-30")).toBe("Le dernier vendredi de chaque mois");
  });
});
