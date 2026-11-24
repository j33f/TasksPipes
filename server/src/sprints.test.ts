import { describe, expect, it } from "vitest";
import { DEFAULT_SPRINT_SETTINGS, cleanDay, cleanSprintSettings, isoWeekday, nextSprintDates, sprintSettings } from "./sprints.js";

describe("sprint settings", () => {
  it("fill what is missing or wrong with the defaults", () => {
    expect(sprintSettings(null)).toEqual(DEFAULT_SPRINT_SETTINGS);
    expect(sprintSettings({ weeks: 3, workDays: [5, 1, 1], initialVelocity: 30, velocityMode: "manual" }))
      .toMatchObject({ weeks: 3, workDays: [1, 5], initialVelocity: 30, velocityMode: "manual", startDay: 1 });
    expect(sprintSettings({ weeks: 9, startDay: 0, workDays: [], initialVelocity: -2 })).toEqual(DEFAULT_SPRINT_SETTINGS);
  });

  it("take only valid values from a request", () => {
    const s = cleanSprintSettings({ weeks: 1, startDay: 3, workDays: [2, 3], velocityMode: "manual", initialVelocity: 21, sendReport: true }, DEFAULT_SPRINT_SETTINGS);
    expect(s).toEqual({ weeks: 1, startDay: 3, workDays: [2, 3], velocityMode: "manual", initialVelocity: 21, sendReport: true });
    expect(cleanSprintSettings({ initialVelocity: null }, s).initialVelocity).toBeNull();
    expect(() => cleanSprintSettings({ weeks: 5 }, s)).toThrow("A sprint lasts 1 to {n} weeks");
    expect(() => cleanSprintSettings({ workDays: [] }, s)).toThrow("Choose at least one working day");
    expect(() => cleanSprintSettings({ velocityMode: "guess" }, s)).toThrow("Invalid sprint settings");
    expect(() => cleanSprintSettings({ initialVelocity: 2.5 }, s)).toThrow("Invalid velocity");
    expect(() => cleanSprintSettings("x", s)).toThrow("Invalid sprint settings");
  });
});

describe("sprint dates", () => {
  it("start on the next start day, or right after the last sprint", () => {
    // 2026-11-25 is a Wednesday.
    expect(isoWeekday("2026-11-25")).toBe(3);
    expect(nextSprintDates(DEFAULT_SPRINT_SETTINGS, null, "2026-11-25")).toEqual({ startsOn: "2026-11-30", endsOn: "2026-12-13" });
    expect(nextSprintDates(DEFAULT_SPRINT_SETTINGS, null, "2026-11-30")).toEqual({ startsOn: "2026-11-30", endsOn: "2026-12-13" });
    expect(nextSprintDates({ ...DEFAULT_SPRINT_SETTINGS, weeks: 1 }, "2026-12-13", "2026-11-25")).toEqual({ startsOn: "2026-12-14", endsOn: "2026-12-20" });
  });

  it("are real days", () => {
    expect(cleanDay("2026-02-28")).toBe("2026-02-28");
    for (const v of ["2026-02-30", "2026-13-01", "26-01-01", 20260101, null]) expect(() => cleanDay(v)).toThrow("Invalid dates");
  });
});
