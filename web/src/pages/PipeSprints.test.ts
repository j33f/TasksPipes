import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/svelte";
import PipePage from "./PipePage.svelte";
import { app } from "../lib/app.svelte";
import type { PipeType, Sprint, TaskType } from "../lib/types";

const scrum: PipeType = {
  id: "scrum", label: "Sprint", group: "G", description: "", color: "", icon: "pipe", taskTypes: [], templates: [], sprints: true,
  columns: [
    { id: "todo", label: "To do", color: "#000", status: "ready" },
    { id: "doing", label: "Doing", color: "#000", status: "started" },
    { id: "done", label: "Done", color: "#000", status: "done" },
  ],
};
const sprint = (id: string, number: number, status: Sprint["status"]): Sprint => ({
  id, number, name: `Sprint ${number}`, goal: number === 1 ? "Sign-in works" : "", startsOn: "2026-11-30", endsOn: "2026-12-13", status,
  committedPoints: status === "active" ? 13 : null, completedPoints: null, exceptional: false, report: null, startedAt: null, closedAt: null,
});
const task = (id: string, stage: string, sprintId: string | null, points: number | null) => ({
  id, number: Number(id.slice(1)), title: `Task ${id}`, stage, status: scrum.columns.find((c) => c.id === stage)!.status, position: 1,
  taskType: "task", assignee: null, author: { id: "u0", name: "Author", avatarUrl: null }, space: { id: "s", name: "Team", kind: "team" },
  pipe: { id: "p", name: "App", visibility: "private", kind: "scrum" }, checklist: { total: 0, done: 0, next: null }, labels: [], priority: null,
  points, sprintId, blockers: 0, commentCount: 0, dueDate: null, outlineDoc: null, gitState: null,
});

let calls: { method: string; url: string; body: any }[];
beforeEach(() => {
  localStorage.clear();
  app.pipeTypes = [scrum];
  app.taskTypes = [{ id: "task", label: "Task" }] as TaskType[];
  calls = [];
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = url === "/api/pipes/p"
      ? {
        id: "p", name: "App", kind: "scrum", visibility: "private", archived: false, counts: {}, icon: null, color: null, description: "",
        space: { id: "s", name: "Team", kind: "team", userId: null, avatarUrl: null, color: null }, myRole: "member", canManage: true, canAddTasks: true, links: [],
        sprintSettings: { weeks: 2, startDay: 1, workDays: [1, 2, 3, 4, 5], velocityMode: "manual", initialVelocity: 10, sendReport: false },
        sprints: [sprint("s2", 2, "planned"), sprint("s1", 1, "active")],
        tasks: [task("t1", "done", "s1", 5), task("t2", "doing", "s1", 8), task("t3", "todo", null, 3), task("t4", "todo", "s2", null)],
      }
      : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a pipe in sprints", () => {
  it("shows the sprint under way on its board, with its progress", async () => {
    render(PipePage, { id: "p" });
    await screen.findByText("Task t1");
    expect(screen.queryByText("Task t3")).toBeNull();
    const banner = screen.getByRole("region", { name: "Sprint 1" });
    expect(within(banner).getByText("5 / 13 pts")).toBeTruthy();
    expect(within(banner).getByText("Sign-in works")).toBeTruthy();
    // Over the velocity (10): flagged.
    expect(within(banner).getByText("velocity 10").classList.contains("over")).toBe(true);
    // Every sprint, or the backlog.
    await fireEvent.change(screen.getByLabelText("Sprint"), { target: { value: "backlog" } });
    expect(screen.getByText("Task t3")).toBeTruthy();
    expect(screen.queryByText("Task t1")).toBeNull();
  });

  it("plans tasks of the backlog in a sprint", async () => {
    render(PipePage, { id: "p" });
    await screen.findByText("Task t1");
    await fireEvent.click(screen.getByRole("button", { name: "Planning" }));
    const backlog = screen.getByRole("region", { name: "Backlog" });
    expect(within(backlog).getByText("Task t3")).toBeTruthy();
    const next = screen.getByRole("region", { name: "Sprint 2" });
    expect(within(next).getByText("Task t4")).toBeTruthy();
    await fireEvent.change(within(backlog).getByLabelText("Sprint of Task t3"), { target: { value: "s2" } });
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: "/api/tasks/t3", body: { sprintId: "s2" } });
    // The sprint under way cannot start twice; a planned one waits for it to close.
    expect((within(next).getByRole("button", { name: /Start the sprint/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
