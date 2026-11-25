import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import TaskContextMenu from "./TaskContextMenu.svelte";
import { app } from "../lib/app.svelte";
import type { Task } from "../lib/types";

const task = (over: Partial<Task> = {}) => ({
  id: "t1", title: "Write the specs", stage: "ready", status: "ready", priority: null,
  space: { id: "team1", name: "Team", kind: "team" }, pipe: { id: "p1", name: "Board", kind: "general" },
  assignee: null, labels: [], ...over,
}) as unknown as Task;

let calls: { method: string; url: string; body: any }[];
let refresh: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  calls = [];
  // After an action the app reads its shared data again: not here, where every answer is made up.
  refresh = vi.spyOn(app, "refresh").mockImplementation(() => {});
  app.me = { user: { id: "u1", name: "Toto" }, personalSpaceId: "s1", features: { invitations: true, notifications: false }, hasAgent: true } as never;
  app.spaces = [{ id: "team1", kind: "team", name: "Team", myRole: "member" }] as never;
  app.pipeTypes = [{ id: "general", columns: [
    { id: "backlog", label: "Backlog", color: "#666", status: "backlog" },
    { id: "ready", label: "Ready", color: "#2bc2ff", status: "ready" },
    { id: "done", label: "Done", color: "#3ad984", status: "done" },
  ] }] as never;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = String(url).endsWith("/spaces/team1")
      ? { pipes: [{ id: "p1", name: "Board", archived: false }, { id: "p2", name: "Later", archived: false }, { id: "p3", name: "Old", archived: true }],
          members: [{ id: "u1", name: "Toto" }, { id: "u2", name: "Lea" }] }
      : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  app.spaces = [];
  app.me = undefined;
});

/** The change the menu sent (the app then reads its data again). */
const change = () => calls.find((c) => c.method !== "GET");

const open = (t = task()) => {
  const onclose = vi.fn();
  render(TaskContextMenu, { task: t, x: 10, y: 10, onclose });
  return onclose;
};

describe("the menu of a task", () => {
  it("changes its column", async () => {
    const onclose = open();
    await userEvent.click(screen.getByRole("menuitem", { name: /Column/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Done" }));
    expect(change()).toMatchObject({ method: "PATCH", url: "/api/tasks/t1", body: { stage: "done" } });
    expect(refresh).toHaveBeenCalled();
    expect(onclose).toHaveBeenCalled();
  });

  it("gives it to a member, or to one's own AI agent", async () => {
    open();
    await userEvent.click(await screen.findByRole("menuitem", { name: /Owner/ }));
    expect(await screen.findByRole("menuitem", { name: "Lea" })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "Toto (MCP)" }));
    expect(change()).toMatchObject({ method: "PATCH", body: { assigneeId: "u1", assigneeAgent: true } });
  });

  it("moves it to another pipe of its space, archived ones left out", async () => {
    open();
    await userEvent.click(screen.getByRole("menuitem", { name: /Move to another pipe/ }));
    expect(screen.queryByRole("menuitem", { name: "Old" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Board" })).toBeNull();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Later" }));
    expect(change()).toMatchObject({ method: "POST", url: "/api/tasks/t1/move", body: { pipeId: "p2" } });
  });

  it("deletes it only once confirmed", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete the task" }));
    expect(confirm).toHaveBeenCalled();
    expect(change()).toBeUndefined();
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete the task" }));
    expect(change()).toMatchObject({ method: "DELETE", url: "/api/tasks/t1" });
  });

  it("offers only to open it outside one's spaces", () => {
    app.spaces = [];
    open();
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent?.trim())).toEqual(["Open the task"]);
  });
});
