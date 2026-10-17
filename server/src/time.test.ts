import { describe, expect, it } from "vitest";
import { addDays, dailyPeriod, isDay, lastWeekday, localDay, weeklyPeriod, zonedInstant, zonedParts } from "./time.js";

describe("time zones", () => {
  it("place a local hour on the right instant, summer time included", () => {
    expect(zonedInstant("2026-01-15", 18, "Europe/Paris").toISOString()).toBe("2026-01-15T17:00:00.000Z"); // UTC+1
    expect(zonedInstant("2026-07-15", 18, "Europe/Paris").toISOString()).toBe("2026-07-15T16:00:00.000Z"); // UTC+2
    expect(zonedInstant("2026-03-29", 18, "Europe/Paris").toISOString()).toBe("2026-03-29T16:00:00.000Z"); // change day
    expect(zonedInstant("2026-10-25", 18, "Europe/Paris").toISOString()).toBe("2026-10-25T17:00:00.000Z");
    expect(zonedInstant("2026-10-16", 18, "UTC").toISOString()).toBe("2026-10-16T18:00:00.000Z");
    expect(zonedInstant("2026-10-16", 18, "America/New_York").toISOString()).toBe("2026-10-16T22:00:00.000Z");
  });

  it("read the local day and weekday of an instant", () => {
    expect(localDay(new Date("2026-10-16T23:30:00Z"), "Europe/Paris")).toBe("2026-10-17");
    expect(localDay(new Date("2026-10-16T23:30:00Z"), "UTC")).toBe("2026-10-16");
    expect(zonedParts(new Date("2026-10-16T12:00:00Z"), "Europe/Paris").weekday).toBe("Fri");
  });
});

describe("periods", () => {
  it("run from the day before at the hour to the day at the hour", () => {
    const p = dailyPeriod("2026-10-16", 18, "Europe/Paris");
    expect(p.start.toISOString()).toBe("2026-10-15T16:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-10-16T16:00:00.000Z");
    // Across the change to winter time, the day lasts 25 hours.
    const change = dailyPeriod("2026-10-25", 18, "Europe/Paris"); // summer time ends on 25 October 2026
    expect(change.end.getTime() - change.start.getTime()).toBe(25 * 3600_000);
    const w = weeklyPeriod("2026-10-16", 18, "UTC");
    expect(w.end.getTime() - w.start.getTime()).toBe(7 * 86400_000);
  });

  it("find the last Friday and step through days", () => {
    expect(lastWeekday("2026-10-16", 5)).toBe("2026-10-16");
    expect(lastWeekday("2026-10-19", 5)).toBe("2026-10-16");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(isDay("2026-10-16")).toBe(true);
    expect(isDay("2026-13-40")).toBe(false);
    expect(isDay("16/10/2026")).toBe(false);
  });
});
