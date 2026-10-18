import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import AcceptDialog from "./AcceptDialog.svelte";
import { app } from "../lib/app.svelte";
import type { Pipe, PipeType, Task, TaskType } from "../lib/types";

const type = (id: string, label: string) => ({ id, label, icon: "task", description: "", fields: [] }) as TaskType;
const pipeType = (id: string, taskTypes: string[]) =>
  ({ id, label: id, group: "G", description: "", color: "", icon: "pipe", taskTypes, templates: [], columns: [{ id: "todo", label: "To do", color: "#000", status: "backlog" }] }) as PipeType;
const pipe = (id: string, kind: string, archived = false) => ({ id, name: id, kind, archived, visibility: "private" }) as Pipe;

let calls: { url: string; body: any }[];
beforeEach(() => {
  app.taskTypes = [type("task", "Task"), type("bug", "Bug"), type("lead", "Lead"), type("story", "Story")];
  app.pipeTypes = [pipeType("dev", ["bug", "story"]), pipeType("sales", ["lead"])];
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("task types in an incoming", () => {
  it("are the plain task and those of the space's pipes still in use", () => {
    expect(app.taskTypesForPipes([pipe("a", "dev"), pipe("b", "sales", true)]).map((t) => t.id)).toEqual(["task", "bug", "story"]);
    expect(app.taskTypesForPipes([]).map((t) => t.id)).toEqual(["task"]);
  });
});

describe("accepting a task", () => {
  it("can turn it into a type of the chosen pipe", async () => {
    const task = { id: "t1", taskType: "lead", space: { id: "s" } } as Task;
    render(AcceptDialog, { task, pipes: [pipe("Dev board", "dev")], onclose: () => {} });
    expect(screen.getByText(/does not offer this type/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Task type"), "bug");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(calls.at(-1)).toMatchObject({ url: "/api/tasks/t1/move", body: { pipeId: "Dev board", taskType: "bug" } });
  });

  it("keeps its type unless changed", async () => {
    const task = { id: "t2", taskType: "bug", space: { id: "s" } } as Task;
    render(AcceptDialog, { task, pipes: [pipe("Dev board", "dev")], onclose: () => {} });
    expect(screen.queryByText(/does not offer this type/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(calls.at(-1)?.body.taskType).toBeUndefined();
  });
});
