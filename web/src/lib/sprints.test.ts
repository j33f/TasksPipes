import { describe, expect, it } from "vitest";
import { activeSprint, openSprints, sprintDay, sprintStats, workingDays } from "./sprints";
import type { Sprint } from "./types";

const sprint = (over: Partial<Sprint>): Sprint => ({
  id: "s", number: 1, name: "Sprint 1", goal: "", startsOn: "2026-11-30", endsOn: "2026-12-13", status: "planned",
  committedPoints: null, completedPoints: null, exceptional: false, report: null, startedAt: null, closedAt: null, ...over,
});

describe("sprints", () => {
  it("count the days worked", () => {
    // Two weeks from a Monday: ten days from Monday to Friday.
    expect(workingDays("2026-11-30", "2026-12-13", [1, 2, 3, 4, 5])).toHaveLength(10);
    expect(workingDays("2026-11-30", "2026-12-13", [1, 3])).toEqual(["2026-11-30", "2026-12-02", "2026-12-07", "2026-12-09"]);
    const s = sprint({});
    expect(sprintDay(s, "2026-11-29", [1, 2, 3, 4, 5])).toEqual({ day: 0, total: 10 });
    expect(sprintDay(s, "2026-12-05", [1, 2, 3, 4, 5])).toEqual({ day: 5, total: 10 });
    expect(sprintDay(s, "2026-12-31", [1, 2, 3, 4, 5])).toEqual({ day: 10, total: 10 });
  });

  it("add up the points of a sprint, dropped tasks left out", () => {
    const tasks = [
      { sprintId: "s", status: "done" as const, points: 5 },
      { sprintId: "s", status: "started" as const, points: 3 },
      { sprintId: "s", status: "ready" as const, points: null },
      { sprintId: "s", status: "abandoned" as const, points: 8 },
      { sprintId: null, status: "ready" as const, points: 13 },
    ];
    expect(sprintStats(tasks, "s")).toEqual({ tasks: 3, doneTasks: 1, points: 8, donePoints: 5, unestimated: 1 });
    expect(sprintStats(tasks, null)).toMatchObject({ tasks: 1, points: 13 });
  });

  it("put the sprint under way first", () => {
    const list = [sprint({ id: "c", number: 1, status: "closed" }), sprint({ id: "p3", number: 3 }), sprint({ id: "a", number: 2, status: "active" }), sprint({ id: "p4", number: 4 })];
    expect(openSprints(list).map((s) => s.id)).toEqual(["a", "p3", "p4"]);
    expect(activeSprint(list)?.id).toBe("a");
    expect(activeSprint([])).toBeNull();
  });
});
