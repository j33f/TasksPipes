import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./app.svelte";
import { columnWith, suggestions } from "./gtd";
import { prefs } from "./i18n.svelte";
import type { PipeType, Task } from "./types";

const general: PipeType = {
  id: "general", label: "General tasks", group: "General", description: "", color: "#000000", icon: "pipe", taskTypes: [], templates: [],
  columns: [
    { id: "backlog", label: "Backlog", color: "", status: "backlog" },
    { id: "ready", label: "Ready", color: "", status: "ready" },
    { id: "ongoing", label: "In progress", color: "", status: "ongoing" },
    { id: "done", label: "Done", color: "", status: "done" },
  ],
};

let n = 0;
const task = (over: Partial<Task>): Task => ({
  id: `t${++n}`, number: n, title: `Task ${n}`, description: "", status: "backlog", stage: "backlog", taskType: "task", fields: {},
  position: n, dueDate: null, space: { id: "s", name: "Me", kind: "user" }, pipe: { id: "p", name: "Personal", visibility: "private", kind: "general" },
  inIncoming: false, author: { id: "u", name: "Me", avatarUrl: null }, assignee: null, sender: null, outlineDoc: null, commentCount: 0,
  checklist: { total: 0, done: 0, next: null }, createdAt: "2026-10-15T09:00:00Z", updatedAt: "2026-10-15T09:00:00Z",
  ...over,
});

beforeEach(() => {
  app.pipeTypes = [general];
  prefs.set({ locale: "en" });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T10:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
  prefs.set({ locale: null });
});

describe("next action", () => {
  it("finds the column to start or finish a task, falling back on the nearest", () => {
    expect(columnWith(task({}), "started", "ongoing")?.id).toBe("ongoing");
    expect(columnWith(task({}), "done")?.id).toBe("done");
    expect(columnWith(task({}), "blocked")).toBeUndefined();
  });

  it("suggests late tasks first, then due soon, then ready ones", () => {
    const later = task({ title: "later" });
    const ready = task({ title: "ready", status: "ready", stage: "ready" });
    const soon = task({ title: "soon", dueDate: "2026-10-18" });
    const late = task({ title: "late", dueDate: "2026-10-13" });
    const doing = task({ title: "doing", status: "ongoing", stage: "ongoing" });
    const list = suggestions([later, ready, soon, late, doing]);
    expect(list.map((s) => s.task.title)).toEqual(["late", "soon", "ready", "later"]);
    expect(list[0].reasons).toContain("3 days late");
    expect(list[1].reasons).toContain("due in 2 days");
  });

  it("explains a long wait and progress on sub-tasks", () => {
    const old = task({ createdAt: "2026-09-01T09:00:00Z", checklist: { total: 4, done: 1, next: { id: "i", text: "x" } } });
    const [s] = suggestions([old]);
    expect(s.reasons).toEqual(expect.arrayContaining(["1/4 sub-tasks already done", "waiting for 45 days"]));
  });
});
