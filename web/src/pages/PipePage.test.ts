import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/svelte";
import PipePage from "./PipePage.svelte";
import { app } from "../lib/app.svelte";
import type { PipeType, TaskType } from "../lib/types";

const kanban: PipeType = {
  id: "kanban", label: "Kanban", group: "G", description: "", color: "", icon: "pipe", taskTypes: ["bug"], templates: [],
  columns: [
    { id: "todo", label: "To do", color: "#000", status: "backlog" },
    { id: "doing", label: "Doing", color: "#000", status: "ongoing", wipLimit: 2 },
    { id: "done", label: "Done", color: "#000", status: "done" },
  ],
};
const person = (id: string, name: string) => ({ id, name, avatarUrl: null });
const task = (id: string, stage: string, assignee: ReturnType<typeof person> | null, taskType = "task") => ({
  id, number: Number(id.slice(1)), title: `Task ${id}`, stage, status: kanban.columns.find((c) => c.id === stage)!.status, position: 1,
  taskType, assignee, author: person("u0", "Author"), space: { id: "s", name: "Team", kind: "team" }, pipe: { id: "p", name: "Board", visibility: "private", kind: "kanban" },
  checklist: { total: 0, done: 0, next: null }, labels: [], priority: null, blockers: 0, commentCount: 0, dueDate: null, outlineDoc: null, gitState: null,
});
const ann = person("u1", "Ann");
const bob = person("u2", "Bob");

let calls: { method: string; url: string; body: any }[];
beforeEach(() => {
  localStorage.clear();
  app.pipeTypes = [kanban];
  app.taskTypes = [{ id: "task", label: "Task" }, { id: "bug", label: "Bug" }] as TaskType[];
  calls = [];
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = url === "/api/pipes/p"
      ? {
        id: "p", name: "Board", kind: "kanban", visibility: "private", archived: false, counts: {}, icon: null, color: null, description: "",
        space: { id: "s", name: "Team", kind: "team", userId: null, avatarUrl: null, color: null }, myRole: "member", canManage: true, canAddTasks: true, links: [],
        tasks: [task("t1", "doing", ann), task("t2", "doing", bob, "bug"), task("t3", "doing", null), task("t4", "todo", ann)],
      }
      : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("pipe board", () => {
  it("warns when a column holds more tasks than its limit", async () => {
    render(PipePage, { id: "p" });
    await screen.findByText("Task t1");
    const doing = screen.getByText("Doing").closest("header")!;
    expect(within(doing).getByText("3 / 2")).toBeTruthy();
    expect(doing.classList.contains("over")).toBe(true);
    expect(screen.getByText("To do").closest("header")!.classList.contains("over")).toBe(false);
  });

  it("shows swimlanes by owner, and a task dropped in another lane changes owner", async () => {
    const { container } = render(PipePage, { id: "p" });
    await screen.findByText("Task t1");
    await fireEvent.change(screen.getByLabelText("Swimlanes"), { target: { value: "owner" } });
    expect([...container.querySelectorAll(".lane-title")].map((e) => e.firstChild?.textContent)).toEqual(["Ann", "Bob", "Unassigned"]);
    expect(localStorage.getItem("tp:pipeLanes")).toBe("owner");

    const card = screen.getByText("Task t3").closest("[data-task-card]")!;
    await fireEvent.dragStart(card, { dataTransfer: { setData: () => {} } });
    await new Promise((r) => setTimeout(r));
    const target = container.querySelector('[data-lane="owner:u2"][data-stage="doing"]')!;
    await fireEvent.dragOver(target, { clientY: 0 });
    await fireEvent.drop(target);
    await vi.waitFor(() => expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: "/api/tasks/t3", body: { assigneeId: "u2" } }));
  });

  it("shows swimlanes by task type", async () => {
    const { container } = render(PipePage, { id: "p" });
    await screen.findByText("Task t1");
    await fireEvent.change(screen.getByLabelText("Swimlanes"), { target: { value: "type" } });
    expect([...container.querySelectorAll(".lane-title")].map((e) => e.firstChild?.textContent)).toEqual(["Task", "Bug"]);
  });
});
