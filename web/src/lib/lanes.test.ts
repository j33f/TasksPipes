import { describe, expect, it } from "vitest";
import { boardLanes, loadLabel, overLimit } from "./lanes";
import { app } from "./app.svelte";
import type { Task, TaskType } from "./types";

const task = (id: string, assignee: string | null, taskType = "task") =>
  ({ id, assignee: assignee ? { id: assignee, name: assignee.toUpperCase(), avatarUrl: null } : null, taskType }) as Task;

describe("swimlanes", () => {
  it("group by owner, the unassigned last, a dropped task taking the lane's owner", () => {
    const lanes = boardLanes([task("1", "zoe"), task("2", null), task("3", "ann")], "owner");
    expect(lanes.map((l) => l.label)).toEqual(["ANN", "ZOE", "Unassigned"]);
    expect(lanes[0].has(task("3", "ann"))).toBe(true);
    expect(lanes[2].change).toEqual({ assigneeId: null });
  });

  it("group by task type, in catalog order", () => {
    app.taskTypes = [{ id: "task", label: "Task" }, { id: "bug", label: "Bug" }, { id: "story", label: "Story" }] as TaskType[];
    const lanes = boardLanes([task("1", null, "story"), task("2", null, "task")], "type");
    expect(lanes.map((l) => l.id)).toEqual(["type:task", "type:story"]);
    expect(lanes[1].change).toEqual({ taskType: "story" });
  });

  it("are a single unnamed lane otherwise", () => {
    expect(boardLanes([task("1", null)], "none")).toMatchObject([{ id: "all", label: null, change: null }]);
  });

  it("show a column's load against its limit", () => {
    expect(loadLabel(3)).toBe("3");
    expect(loadLabel(3, 5)).toBe("3 / 5");
    expect(overLimit(5, 5)).toBe(false);
    expect(overLimit(6, 5)).toBe(true);
    expect(overLimit(9)).toBe(false);
  });
});
