import { describe, expect, it } from "vitest";
import { pipeBurndown, sprintBurndown, sprintDays, stateAt, type HistoryEntry, type TaskNow } from "./burndown.js";

const at = (s: string) => new Date(`${s}Z`);
const task = (id: string, over: Partial<TaskNow> = {}): TaskNow => ({
  id, createdAt: at("2026-11-29T10:00:00"), pipeId: "p", sprintId: "s", points: 5, status: "done", assignee: null, taskType: "user_story", ...over,
});
const entry = (taskId: string, when: string, over: Partial<HistoryEntry>): HistoryEntry => ({
  taskId, at: at(when), fromStatus: "started", fromPipeId: "p", details: null, ...over,
});

describe("a task's state in the past", () => {
  it("undoes the changes made since", () => {
    const t = task("a", { points: 8, status: "done" });
    const h = [
      entry("a", "2026-12-01T09:00:00", { fromStatus: "ready", details: { sprint: { from: null } } }),
      entry("a", "2026-12-02T09:00:00", { fromStatus: "ready", details: { points: { from: 5 } } }),
      entry("a", "2026-12-03T09:00:00", { fromStatus: "started" }),
    ];
    expect(stateAt(t, h, at("2026-11-28T00:00:00"))).toBeNull();
    expect(stateAt(t, h, at("2026-11-30T00:00:00"))).toMatchObject({ sprintId: null, points: 5, status: "ready" });
    expect(stateAt(t, h, at("2026-12-01T12:00:00"))).toMatchObject({ sprintId: "s", points: 5, status: "ready" });
    expect(stateAt(t, h, at("2026-12-02T12:00:00"))).toMatchObject({ sprintId: "s", points: 8, status: "started" });
    expect(stateAt(t, h, at("2026-12-04T00:00:00"))).toMatchObject({ points: 8, status: "done" });
  });
});

describe("a sprint's burndown", () => {
  // Monday 30 November to Friday 4 December, in UTC.
  const sprint = { id: "s", startsOn: "2026-11-30", endsOn: "2026-12-04" };
  const week = [1, 2, 3, 4, 5];

  it("goes down as tasks are done, and shows tasks added on the way", () => {
    const tasks = [task("a"), task("b", { points: 3, status: "started" }), task("c", { points: 2 })];
    const history = [
      entry("a", "2026-12-01T15:00:00", { fromStatus: "started" }),
      // Added on Wednesday, done on Thursday.
      entry("c", "2026-12-02T10:00:00", { fromStatus: "ready", details: { sprint: { from: null } } }),
      entry("c", "2026-12-03T10:00:00", { fromStatus: "started" }),
    ];
    const points = sprintBurndown(sprint, week, tasks, history, at("2026-12-03T18:00:00"), "UTC");
    expect(sprintDays(sprint.startsOn, sprint.endsOn, week)).toHaveLength(5);
    expect(points.map((p) => p.day)).toEqual([null, "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]);
    expect(points.map((p) => p.ideal)).toEqual([8, 6.4, 4.8, 3.2, 1.6, 0]);
    expect(points.map((p) => p.remaining)).toEqual([8, 8, 3, 5, 3, null]);
    expect(points.map((p) => p.scope)).toEqual([8, 8, 8, 10, 10, null]);
  });
});

describe("a pipe's burndown", () => {
  it("counts the points done and to do in the pipe at the end of each sprint", () => {
    const tasks = [task("a", { sprintId: null }), task("b", { points: 3, status: "ready", sprintId: null }), task("c", { points: 8, pipeId: "other", status: "ready" })];
    const history = [
      entry("a", "2026-12-08T10:00:00", { fromStatus: "started" }),
      // Moved to another pipe on 10 December.
      entry("c", "2026-12-10T10:00:00", { fromStatus: "ready", fromPipeId: "p" }),
    ];
    const rows = pipeBurndown("p", [
      { id: "s1", name: "Sprint 1", endsOn: "2026-12-06", endAt: at("2026-12-07T00:00:00") },
      { id: "s2", name: "Sprint 2", endsOn: "2026-12-13", endAt: at("2026-12-14T00:00:00") },
    ], tasks, history);
    expect(rows.map((r) => [r.done, r.remaining])).toEqual([[0, 16], [5, 3]]);
  });
});
