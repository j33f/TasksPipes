import { describe, expect, it } from "vitest";
import { dayList, daysBetween, shiftSpan, taskSpan, timelineRange } from "./timeline";

const sprint = { startsOn: "2026-11-30", endsOn: "2026-12-13" };

describe("timeline", () => {
  it("draws a task from its dates, or from its sprint for what is missing", () => {
    expect(taskSpan({ startDate: "2026-12-01", dueDate: "2026-12-04", sprintId: "s" }, sprint)).toEqual({ start: "2026-12-01", end: "2026-12-04", inferred: false });
    expect(taskSpan({ startDate: null, dueDate: "2026-12-04", sprintId: "s" }, sprint)).toEqual({ start: "2026-11-30", end: "2026-12-04", inferred: true });
    expect(taskSpan({ startDate: "2026-12-10", dueDate: null, sprintId: "s" }, sprint)).toEqual({ start: "2026-12-10", end: "2026-12-13", inferred: true });
    expect(taskSpan({ startDate: null, dueDate: null, sprintId: "s" }, sprint)).toEqual({ start: "2026-11-30", end: "2026-12-13", inferred: true });
    // A date outside the sprint still counts.
    expect(taskSpan({ startDate: "2026-12-20", dueDate: null, sprintId: "s" }, sprint)).toEqual({ start: "2026-12-20", end: "2026-12-20", inferred: true });
    expect(taskSpan({ startDate: null, dueDate: "2026-12-04", sprintId: null }, null)).toEqual({ start: "2026-12-04", end: "2026-12-04", inferred: false });
    expect(taskSpan({ startDate: null, dueDate: null, sprintId: null }, null)).toBeNull();
  });

  it("spans every bar and today, with a margin", () => {
    expect(timelineRange([{ start: "2026-12-01", end: "2026-12-04" }, { start: "2026-11-28", end: "2026-12-02" }], "2026-11-24"))
      .toEqual({ start: "2026-11-22", end: "2026-12-06" });
    expect(timelineRange([], "2026-11-24")).toEqual({ start: "2026-11-22", end: "2026-12-08" });
    expect(dayList("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(daysBetween("2026-11-29", "2026-12-02")).toBe(3);
  });

  it("moves or stretches a bar by whole days, its ends never crossing", () => {
    const s = { start: "2026-12-01", end: "2026-12-04" };
    expect(shiftSpan(s, "move", 2)).toEqual({ start: "2026-12-03", end: "2026-12-06" });
    expect(shiftSpan(s, "start", 5)).toEqual({ start: "2026-12-04", end: "2026-12-04" });
    expect(shiftSpan(s, "end", -1)).toEqual({ start: "2026-12-01", end: "2026-12-03" });
    expect(shiftSpan(s, "end", -9)).toEqual({ start: "2026-12-01", end: "2026-12-01" });
  });
});
