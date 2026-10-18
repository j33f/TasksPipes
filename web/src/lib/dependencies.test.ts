import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmWhileBlocked, dependencyLabel, movesWhileBlocked } from "./dependencies";

afterEach(() => vi.unstubAllGlobals());

describe("dependencies", () => {
  it("ask before moving a blocked task on, only then", () => {
    const blocked = { status: "ready" as const, blockers: 2 };
    expect(movesWhileBlocked(blocked, "started")).toBe(true);
    expect(movesWhileBlocked(blocked, "done")).toBe(true);
    expect(movesWhileBlocked(blocked, "backlog")).toBe(false);
    expect(movesWhileBlocked(blocked, "ready")).toBe(false);
    expect(movesWhileBlocked({ status: "ready", blockers: 0 }, "done")).toBe(false);
    const ask = vi.fn(() => false);
    vi.stubGlobal("confirm", ask);
    expect(confirmWhileBlocked(blocked, "done")).toBe(false);
    expect(ask).toHaveBeenCalledOnce();
    expect(confirmWhileBlocked(blocked, "backlog")).toBe(true);
    expect(ask).toHaveBeenCalledOnce();
  });

  it("show a task one cannot open by its title only, and a masked one not at all", () => {
    expect(dependencyLabel({ id: "a", number: 12, title: "Specs", resolved: false, visible: true })).toBe("#12 Specs");
    expect(dependencyLabel({ title: "Budget", owner: { name: "Bob" }, resolved: false, visible: false })).toBe("Budget");
    expect(dependencyLabel({ id: "b", resolved: true, visible: false, masked: true })).toBe("Task not accessible");
  });
});
