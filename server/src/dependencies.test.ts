import { describe, expect, it } from "vitest";
import { isResolved, presentDependency } from "./dependencies.js";

const row = { id: "t", number: 7, title: "Budget", status: "ongoing", task_type: "task", pipe_kind: "general", owner_id: "u", owner_name: "Carol" };

describe("dependencies", () => {
  it("are finished once done or abandoned", () => {
    expect(["done", "abandoned"].map(isResolved)).toEqual([true, true]);
    expect(["backlog", "blocked", "ongoing", null].map(isResolved)).toEqual([false, false, false, false]);
  });

  it("show a task one can open in full", () => {
    expect(presentDependency({ ...row, visible: true }, false)).toEqual({
      id: "t", number: 7, title: "Budget", status: "ongoing", owner: { id: "u", name: "Carol" }, resolved: false, visible: true,
    });
  });

  it("show a task one cannot open by its title and owner only, its id only when it blocks", () => {
    expect(presentDependency({ ...row, visible: false }, false)).toEqual({ title: "Budget", owner: { name: "Carol" }, resolved: false, visible: false });
    expect(presentDependency({ ...row, visible: false }, true)).toMatchObject({ id: "t", title: "Budget" });
  });

  it("show nothing of a confidential or team-only task one cannot open", () => {
    for (const r of [{ pipe_kind: "sante" }, { pipe_kind: "psh" }, { pipe_kind: null, task_type: "rdv_sante" }]) {
      expect(presentDependency({ ...row, ...r, status: "done", visible: false }, true)).toEqual({ id: "t", resolved: true, visible: false, masked: true });
    }
  });
});
