import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import Timeline from "./Timeline.svelte";
import { app } from "../lib/app.svelte";
import type { PipeDetail, PipeType, Sprint } from "../lib/types";

const scrum: PipeType = {
  id: "scrum", label: "Sprint", group: "G", description: "", color: "", icon: "pipe", taskTypes: [], templates: [], sprints: true,
  columns: [{ id: "todo", label: "To do", color: "#000", status: "ready" }, { id: "done", label: "Done", color: "#000", status: "done" }],
};
const sprint = (id: string, number: number, status: Sprint["status"], startsOn: string, endsOn: string): Sprint => ({
  id, number, name: `Sprint ${number}`, goal: "", startsOn, endsOn, status, committedPoints: null, completedPoints: null,
  exceptional: false, report: null, startedAt: null, closedAt: null,
});
const task = (id: string, over: Record<string, unknown>) => ({
  id, number: 1, title: `Task ${id}`, stage: "todo", status: "ready", position: 1, taskType: "task", assignee: null, points: 3, sprintId: null,
  startDate: null, dueDate: null, labels: [], ...over,
});
const pipe = {
  id: "p", kind: "scrum", canManage: true, archived: false, sprintSettings: { weeks: 2, startDay: 1, workDays: [1, 2, 3, 4, 5], velocityMode: "manual", initialVelocity: 20, sendReport: false },
  sprints: [sprint("s1", 1, "closed", "2026-11-02", "2026-11-15"), sprint("s2", 2, "active", "2026-11-16", "2026-11-29")],
  tasks: [
    task("old", { sprintId: "s1", status: "done", stage: "done" }),
    task("a", { sprintId: "s2", startDate: "2026-11-17", dueDate: "2026-11-19" }),
    task("b", { sprintId: "s2" }),
    task("c", { dueDate: "2026-12-04" }),
    task("none", {}),
    task("gone", { status: "abandoned", sprintId: "s2" }),
  ],
} as unknown as PipeDetail;

let calls: { method: string; url: string; body: any }[];
beforeEach(() => {
  app.pipeTypes = [scrum];
  calls = [];
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = url.endsWith("/dependencies") ? [{ taskId: "b", waitsFor: "a" }] : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the timeline", () => {
  it("shows all the sprints, the closed ones folded, their tasks as bars, and the tasks out of any sprint", async () => {
    const { container } = render(Timeline, { pipe, sprintId: "all" });
    expect(screen.getByRole("button", { name: /Sprint 1/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Task old")).toBeNull();
    expect(screen.getByText("Task a")).toBeTruthy();
    expect(screen.getByText("Task c")).toBeTruthy();
    expect(screen.queryByText("Task gone")).toBeNull();
    // Without its own dates, a task takes those of its sprint, drawn as such.
    expect(screen.getByRole("button", { name: /^Task b, / }).classList.contains("inferred")).toBe(true);
    expect(screen.getByRole("button", { name: /^Task a, / }).classList.contains("inferred")).toBe(false);
    expect(screen.getByText("1 task with no date and no sprint is not on the timeline.")).toBeTruthy();
    // Task b waits for task a, which ends after b starts: the arrow is red.
    await vi.waitFor(() => expect(container.querySelectorAll("path.arrow").length).toBe(1));
    expect(container.querySelector("path.arrow")!.classList.contains("late")).toBe(true);
    await fireEvent.click(screen.getByRole("button", { name: /Sprint 1/ }));
    expect(screen.getByText("Task old")).toBeTruthy();
  });

  it("shows one sprint's tasks only", () => {
    render(Timeline, { pipe, sprintId: "s2" });
    expect(screen.getByText("Task a")).toBeTruthy();
    expect(screen.queryByText("Task c")).toBeNull();
    expect(screen.queryByRole("button", { name: /Sprint 2/ })).toBeNull();
  });
});
