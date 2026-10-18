import { describe, expect, it } from "vitest";
import { byPriority, distinctLabels, labelText, matches, priorityName } from "./labels";

const label = (id: string, name: string) => ({ id, name, color: "#2bc2ff" });
const task = (over = {}) => ({ labels: [label("a", "Client")], priority: 2 as const, assignee: { id: "u", name: "Ann", avatarUrl: null }, taskType: "bug", ...over });

describe("labels and priority", () => {
  it("filter tasks by label name, priority, owner and type", () => {
    expect(matches(task(), {})).toBe(true);
    expect(matches(task(), { labels: ["client"] })).toBe(true);
    expect(matches(task(), { labels: ["Urgent fix"] })).toBe(false);
    expect(matches(task(), { priority: 2 })).toBe(true);
    expect(matches(task({ priority: null }), { priority: 0 })).toBe(true);
    expect(matches(task(), { priority: 0 })).toBe(false);
    expect(matches(task(), { owner: "u" })).toBe(true);
    expect(matches(task(), { owner: "none" })).toBe(false);
    expect(matches(task({ assignee: null }), { owner: "none" })).toBe(true);
    expect(matches(task(), { type: "story" })).toBe(false);
  });

  it("sort the most urgent first, tasks without priority last", () => {
    const list = [{ id: 1, priority: null }, { id: 2, priority: 4 as const }, { id: 3, priority: 1 as const }];
    expect(byPriority(list).map((x) => x.id)).toEqual([3, 2, 1]);
  });

  it("merge labels of several spaces by name", () => {
    expect(distinctLabels([label("1", "Zeta"), label("2", "client"), label("3", "Client")]).map((l) => l.id)).toEqual(["2", "1"]);
  });

  it("read well on any color", () => {
    expect(labelText("#f5c518")).toBe("#111319");
    expect(labelText("#0366d6")).toBe("#ffffff");
    expect(priorityName(1)).toBe("Urgent");
    expect(priorityName(null)).toBe("No priority");
  });
});
