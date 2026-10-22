import { describe, expect, it } from "vitest";
import { cleanRule, monthlyDay, nextDate, occurrencesBetween, upcoming, weekday } from "./recurrence.js";

describe("recurring dates", () => {
  it("know the weekdays", () => {
    expect(weekday("2026-10-19")).toBe(1); // a Monday
    expect(weekday("2026-10-25")).toBe(7);
  });

  it("repeat every n days", () => {
    expect(upcoming({ freq: "daily", interval: 1 }, "2026-10-19", "2026-10-19", 3)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(upcoming({ freq: "daily", interval: 3 }, "2026-10-19", "2026-10-20", 2)).toEqual(["2026-10-22", "2026-10-25"]);
  });

  it("repeat on chosen weekdays, every n weeks", () => {
    // Mondays and Thursdays.
    expect(upcoming({ freq: "weekly", interval: 1, weekdays: [1, 4] }, "2026-10-19", "2026-10-19", 4))
      .toEqual(["2026-10-22", "2026-10-26", "2026-10-29", "2026-11-02"]);
    // Every other week, on Fridays, counted from the start's week.
    expect(upcoming({ freq: "weekly", interval: 2, weekdays: [5] }, "2026-10-19", "2026-10-19", 3))
      .toEqual(["2026-10-23", "2026-11-06", "2026-11-20"]);
  });

  it("fall on a day of the month, the 31st becoming the last day", () => {
    expect(upcoming({ freq: "monthly", interval: 1, monthly: { kind: "day", day: 10 } }, "2026-10-10", "2026-10-10", 3))
      .toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);
    expect(upcoming({ freq: "monthly", interval: 1, monthly: { kind: "day", day: 31 } }, "2027-01-31", "2027-01-31", 3))
      .toEqual(["2027-02-28", "2027-03-31", "2027-04-30"]);
  });

  it("fall on the n-th or last weekday of the month", () => {
    // The first Monday.
    expect(upcoming({ freq: "monthly", interval: 1, monthly: { kind: "weekday", nth: 1, weekday: 1 } }, "2026-10-05", "2026-10-05", 3))
      .toEqual(["2026-11-02", "2026-12-07", "2027-01-04"]);
    // The last Friday, every quarter.
    expect(upcoming({ freq: "monthly", interval: 3, monthly: { kind: "weekday", nth: -1, weekday: 5 } }, "2026-10-30", "2026-10-30", 2))
      .toEqual(["2027-01-29", "2027-04-30"]);
    expect(monthlyDay({ kind: "weekday", nth: 3, weekday: 3 }, 2026, 9)).toBe("2026-10-21");
  });

  it("fall on the last business day, Monday to Friday", () => {
    // 31 October 2026 is a Saturday; 28 February 2027 a Sunday.
    expect(monthlyDay({ kind: "lastBusinessDay" }, 2026, 9)).toBe("2026-10-30");
    expect(monthlyDay({ kind: "lastBusinessDay" }, 2027, 1)).toBe("2027-02-26");
    expect(monthlyDay({ kind: "lastBusinessDay" }, 2026, 11)).toBe("2026-12-31");
  });

  it("repeat every n years, 29 February on the 28th otherwise", () => {
    expect(upcoming({ freq: "yearly", interval: 1 }, "2028-02-29", "2028-02-29", 2)).toEqual(["2029-02-28", "2030-02-28"]);
    expect(nextDate({ freq: "yearly", interval: 2 }, "2026-03-15", "2026-03-15")).toBe("2028-03-15");
  });

  it("start from any date, and stop at the end", () => {
    // Far after the start: the dates keep their rhythm.
    expect(nextDate({ freq: "daily", interval: 7 }, "2026-01-01", "2026-10-18")).toBe("2026-10-22");
    expect(nextDate({ freq: "monthly", interval: 2, monthly: { kind: "day", day: 1 } }, "2026-01-01", "2026-10-18")).toBe("2026-11-01");
    expect(upcoming({ freq: "daily", interval: 1 }, "2026-10-19", "2026-10-19", 10, "2026-10-21")).toEqual(["2026-10-20", "2026-10-21"]);
  });

  it("take only well-formed rules", () => {
    expect(cleanRule({ freq: "weekly", weekdays: [4, 1, 1] })).toEqual({ freq: "weekly", interval: 1, weekdays: [1, 4] });
    expect(() => cleanRule({ freq: "hourly" })).toThrow("Invalid repetition");
    expect(() => cleanRule({ freq: "weekly", weekdays: [] })).toThrow("Choose at least one day of the week");
    expect(() => cleanRule({ freq: "monthly", monthly: { kind: "weekday", nth: 5, weekday: 1 } })).toThrow("Invalid repetition");
    expect(() => cleanRule({ freq: "daily", interval: 0 })).toThrow("Invalid repetition");
  });
});

describe("occurrences within a window (calendar projection)", () => {
  const daily = { freq: "daily", interval: 1 } as const;

  it("returns the dates from the next one, inside [from, to]", () => {
    // Series next falls on the 19th; a window starting after it skips the earlier dates.
    expect(occurrencesBetween(daily, "2026-10-19", "2026-10-19", "2026-10-21", "2026-10-24"))
      .toEqual(["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
  });

  it("starts at the next date even when it is inside the window", () => {
    expect(occurrencesBetween(daily, "2026-10-19", "2026-10-22", "2026-10-19", "2026-10-25"))
      .toEqual(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  });

  it("stops at the series end", () => {
    expect(occurrencesBetween(daily, "2026-10-19", "2026-10-20", "2026-10-19", "2026-10-31", "2026-10-22"))
      .toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
  });

  it("is empty when the next date is past the window", () => {
    expect(occurrencesBetween(daily, "2026-10-19", "2026-11-10", "2026-10-19", "2026-10-31")).toEqual([]);
  });

  it("follows the rhythm of weekly rules", () => {
    // Every Monday, next on the 26th, across four weeks.
    expect(occurrencesBetween({ freq: "weekly", interval: 1, weekdays: [1] }, "2026-10-19", "2026-10-26", "2026-10-19", "2026-11-16"))
      .toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
  });

  it("caps the number returned", () => {
    expect(occurrencesBetween(daily, "2026-10-19", "2026-10-19", "2026-10-19", "2027-10-19", null, 5))
      .toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
  });
});
