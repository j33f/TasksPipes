import { describe, expect, it } from "vitest";
import { dailyEmail, dailyReport, duration, stepTimes, weeklyEmail, weeklyReport, type EventRow, type TaskInfo } from "./reports.js";

const H = 3600_000;
const T0 = new Date("2026-10-15T09:00:00Z").getTime();
const at = (h: number) => new Date(T0 + h * H);

describe("stepTimes", () => {
  const step = (h: number, status: string, stage: string | null, incoming = false) => ({ createdAt: at(h), to: { status: status as never, stage, location: { incoming } } });

  it("adds up the time spent in each column, in order of first visit", () => {
    const timing = stepTimes([step(0, "backlog", "Backlog"), step(2, "ongoing", "In progress"), step(5, "blocked", "Blocked"), step(6, "ongoing", "In progress"), step(9, "done", "Done")], at(20));
    expect(timing.steps.map((s) => [s.label, s.ms / H])).toEqual([["Backlog", 2], ["In progress", 6], ["Blocked", 1], ["Done", 11]]);
    expect(timing).toMatchObject({ done: true, leadMs: 9 * H, cycleMs: 7 * H, current: null });
  });

  it("counts the incoming bucket and the step the task is in now", () => {
    const timing = stepTimes([step(0, "backlog", null, true), step(3, "backlog", "Backlog")], at(4));
    expect(timing.steps.map((s) => [s.incoming, s.ms / H])).toEqual([[true, 3], [false, 1]]);
    expect(timing).toMatchObject({ done: false, cycleMs: null, leadMs: 4 * H, current: { label: "Backlog", since: at(3).toISOString() } });
  });

  it("forgets a done task that was reopened", () => {
    const timing = stepTimes([step(0, "ongoing", "Doing"), step(1, "done", "Done"), step(2, "ongoing", "Doing")], at(5));
    expect(timing.done).toBe(false);
    expect(timing.leadMs).toBe(5 * H);
  });
});

const P = "pipe-1";
const tasks = new Map<string, TaskInfo>([
  ["a", { id: "a", number: 1, title: "A", taskType: "user_story", owner: "Ana" }],
  ["b", { id: "b", number: 2, title: "B", taskType: "bug", owner: null }],
  ["c", { id: "c", number: 3, title: "C", taskType: "bug", owner: null }],
]);
const ev = (task: string, h: number, type: string, from: string | null, to: string, fromPipe: string | null = P, toPipe: string | null = P, stage = to): EventRow =>
  ({ task_id: task, type, created_at: at(h), from_status: from as never, to_status: to as never, from_pipe_id: fromPipe, to_pipe_id: toPipe, to_stage: stage });

const events: EventRow[] = [
  // A: created the day before, started and done in the period.
  ev("a", -30, "created", null, "backlog", null), ev("a", 2, "status", "backlog", "ongoing"), ev("a", 6, "status", "ongoing", "done"),
  // B: created in the period, started, blocked.
  ev("b", 1, "created", null, "backlog", null), ev("b", 3, "status", "backlog", "started"), ev("b", 8, "status", "started", "blocked"),
  // C: in progress since before the period, then moved to another pipe.
  ev("c", -20, "created", null, "ongoing", null), ev("c", 4, "moved", "ongoing", "ongoing", P, "pipe-2"),
];
const period = { start: at(0), end: at(10) };

describe("dailyReport", () => {
  it("sorts what happened in the period, and where things stand at its end", () => {
    const r = dailyReport(P, tasks, events, period);
    const ids = (list: { id: string }[]) => list.map((t) => t.id);
    expect(ids(r.created)).toEqual(["b"]);
    expect(ids(r.started).sort()).toEqual(["a", "b"]);
    expect(ids(r.done)).toEqual(["a"]);
    expect(ids(r.blocked)).toEqual(["b"]);
    expect(ids(r.inProgress)).toEqual([]); // C left the pipe
    expect(ids(r.stillBlocked)).toEqual(["b"]);
  });

  it("ignores events outside the period", () => {
    const r = dailyReport(P, tasks, events, { start: at(20), end: at(30) });
    expect(r.started).toEqual([]);
    expect(r.stillBlocked.map((t) => t.id)).toEqual(["b"]);
  });
});

describe("weeklyReport", () => {
  it("adds up the time in progress and blocked per task type, within the period", () => {
    const r = weeklyReport(P, tasks, events, period);
    const bug = r.byType.find((x) => x.taskType === "bug")!;
    const story = r.byType.find((x) => x.taskType === "user_story")!;
    expect(story).toMatchObject({ activeMs: 4 * H, done: 1, tasks: 1 });
    // B: started 3→8 (5 h) then blocked 8→10 (2 h); C: in progress 0→4 in this pipe (4 h).
    expect(bug).toMatchObject({ activeMs: 9 * H, blockedMs: 2 * H, tasks: 2, done: 0 });
    expect(r.totalActiveMs).toBe(13 * H);
    expect(r.tasks[0].id).toBe("b");
  });
});

describe("e-mails", () => {
  const pipe = { id: P, name: "App", kind: "dev", space_id: "s" };

  it("render the daily report in the reader's language, and say when it is empty", () => {
    const fr = dailyEmail(pipe, dailyReport(P, tasks, events, period), "fr", "2026-10-15");
    expect(fr.subject).toBe("Activité de App — 2026-10-15");
    expect(fr.html).toContain("Tâches démarrées (2)");
    expect(fr.html).toContain("TP-1</a> A");
    expect(fr.empty).toBe(false);
    expect(dailyEmail(pipe, dailyReport(P, new Map(), [], period), "en", "2026-10-15").empty).toBe(true);
  });

  it("render the weekly time report with durations", () => {
    const en = weeklyEmail(pipe, weeklyReport(P, tasks, events, period), "en", "2026-10-16");
    expect(en.subject).toBe("Time report of App — week to 2026-10-16");
    expect(en.html).toContain("Bug");
    expect(en.html).toContain("9 h");
    expect(duration(45 * 60_000, "en")).toBe("45 min");
    expect(duration(5 * H + 20 * 60_000, "fr")).toBe("5 h 20");
    expect(duration(76 * H, "fr")).toBe("3 j 4 h");
  });
});
