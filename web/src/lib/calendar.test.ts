import { afterEach, describe, expect, it } from "vitest";
import { addDays, addMonths, monthGrid, monthTitle, weekOf, weekStart, weekdayShort } from "./calendar";
import { prefs } from "./i18n.svelte";

afterEach(() => prefs.set({ locale: "en", theme: null }));

describe("calendar dates", () => {
  it("count days and months across their ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("start weeks on Monday", () => {
    expect(weekStart("2026-10-18")).toBe("2026-10-12");
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    expect(weekOf("2026-10-21")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  });

  it("show whole weeks around a month", () => {
    const grid = monthGrid("2026-10-18");
    expect(grid).toHaveLength(5);
    expect(grid[0][0]).toBe("2026-09-28");
    expect(grid.at(-1)!.at(-1)).toBe("2026-11-01");
    // February 2027 starts on a Monday and ends on a Sunday: four weeks.
    expect(monthGrid("2027-02-10")).toHaveLength(4);
  });

  it("speak the user's language", () => {
    prefs.set({ locale: "en", theme: null });
    expect(monthTitle("2026-10-01")).toBe("October 2026");
    prefs.set({ locale: "fr", theme: null });
    expect(monthTitle("2026-10-01")).toBe("octobre 2026");
    expect(weekdayShort("2026-10-19")).toBe("lun.");
  });
});
