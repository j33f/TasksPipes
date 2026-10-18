import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import DependenciesSection from "./DependenciesSection.svelte";
import type { Dependency, TaskDetail } from "../lib/types";

const task = (over: Partial<TaskDetail> = {}) => ({
  id: "t1", blockers: 2, blockedBy: [], blocks: [],
  permissions: { view: true, manage: true, editContent: true, comment: true, refuse: false }, ...over,
}) as TaskDetail;
const visible: Dependency = { id: "a", number: 12, title: "Write the specs", status: "ongoing", owner: { id: "u", name: "Bob" }, resolved: false, visible: true };
const hidden: Dependency = { id: "b", title: "Budget approval", owner: { name: "Carol" }, resolved: false, visible: false };
const masked: Dependency = { id: "c", resolved: true, visible: false, masked: true };

let calls: { method: string; url: string; body: any }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = String(url).includes("/search")
      ? [{ id: "t1", number: 1, title: "Itself" }, { id: "a", number: 12, title: "Write the specs" }, { id: "d", number: 30, title: "Deploy", owner: null }]
      : { blockedBy: [], blocks: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("dependencies section", () => {
  it("shows a task one cannot open by its title and owner, and a masked one by nothing", () => {
    render(DependenciesSection, { task: task({ blockedBy: [visible, hidden, masked], blocks: [{ title: "Launch", owner: null, resolved: false, visible: false }] }), onchange: () => {} });
    expect(screen.getByRole("button", { name: "#12 Write the specs" })).toBeTruthy();
    expect(screen.getByText("Budget approval").tagName).toBe("SPAN");
    expect(screen.getByText(/Carol/)).toBeTruthy();
    expect(screen.getByText("Task not accessible")).toBeTruthy();
    expect(screen.getByText("Launch")).toBeTruthy();
    // Each blocker can be unlinked, those waiting for this task cannot from here.
    expect(screen.getAllByTitle("Stop waiting for it")).toHaveLength(3);
  });

  it("unlinks a blocker one cannot open", async () => {
    const onchange = vi.fn();
    render(DependenciesSection, { task: task({ blockedBy: [hidden] }), onchange });
    await userEvent.click(screen.getByTitle("Stop waiting for it"));
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: "/api/tasks/t1/dependencies/b" });
    expect(onchange).toHaveBeenCalled();
  });

  it("adds a task found by search, leaving out this one and those already awaited", async () => {
    render(DependenciesSection, { task: task({ blockedBy: [visible] }), onchange: () => {} });
    await userEvent.click(screen.getByRole("button", { name: "Add a task it waits for" }));
    await userEvent.type(screen.getByLabelText("Search a task…"), "de");
    const deploy = await screen.findByRole("button", { name: "#30 Deploy" });
    expect(screen.queryByRole("button", { name: "#1 Itself" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "#12 Write the specs" })).toHaveLength(1);
    await userEvent.click(deploy);
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: "/api/tasks/t1/dependencies", body: { blockerId: "d" } });
  });

  it("is read-only for those who cannot edit the task", () => {
    render(DependenciesSection, { task: task({ blockedBy: [visible], permissions: { view: true, manage: false, editContent: false, comment: true, refuse: false } }), onchange: () => {} });
    expect(screen.queryByTitle("Stop waiting for it")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a task it waits for" })).toBeNull();
  });
});
