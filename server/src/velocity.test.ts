import { describe, expect, it } from "vitest";
import { median, velocity, type ClosedSprint } from "./velocity.js";

// Two-week sprints, one after another (the latest last).
const sprints = (points: number[], over: Partial<ClosedSprint>[] = []): ClosedSprint[] =>
  points.map((p, i) => {
    const start = new Date(Date.UTC(2026, 0, 5 + 14 * i));
    const end = new Date(start.getTime() + 13 * 86_400_000);
    return { id: `s${i + 1}`, name: `Sprint ${i + 1}`, startsOn: start.toISOString().slice(0, 10), endsOn: end.toISOString().slice(0, 10), completedPoints: p, exceptional: false, ...over[i] };
  });
const learned = { velocityMode: "learned" as const, initialVelocity: 20, weeks: 2 };

describe("velocity", () => {
  it("takes the median of even and odd lists", () => {
    expect([median([3, 1, 2]), median([4, 1, 3, 2]), median([])]).toEqual([2, 2.5, 0]);
  });

  it("is a low average of the last sprints, outliers left out (the example of the plan)", () => {
    // 36 is a good sprint, not an outlier: only 12 is far enough from the others.
    // 30, 34, 12, 31, 36, 29 points in two weeks: 12 is left out; the low average of 29, 30, 31 is 30.
    const v = velocity(sprints([30, 34, 12, 31, 36, 29]), learned);
    expect(v).toMatchObject({ value: 30, source: "learned", perWeek: 15 });
    expect(v.samples.filter((s) => s.excluded).map((s) => [s.name, s.excluded])).toEqual([["Sprint 3", "outlier"]]);
  });

  it("leaves out the sprints marked exceptional, and keeps only the last six", () => {
    const v = velocity(sprints([100, 20, 20, 2, 22, 20, 24], [{}, {}, {}, { exceptional: true }]), learned);
    expect(v.samples).toHaveLength(6);
    expect(v.samples.find((s) => s.name === "Sprint 4")?.excluded).toBe("exceptional");
    expect(v.samples.some((s) => s.name === "Sprint 1")).toBe(false);
    expect(v.value).toBe(20);
  });

  it("leaves out no sprint when most did the same", () => {
    expect(velocity(sprints([20, 20, 20, 26]), learned)).toMatchObject({ value: 20, perWeek: 10 });
    expect(velocity(sprints([20, 20, 20, 26]), learned).samples.every((s) => !s.excluded)).toBe(true);
  });

  it("follows the length of the sprints", () => {
    expect(velocity(sprints([30, 30, 30]), { ...learned, weeks: 1 }).value).toBe(15);
  });

  it("uses the initial velocity until three sprints count, or when set by hand", () => {
    expect(velocity(sprints([30, 30]), learned)).toMatchObject({ value: 20, source: "initial", perWeek: null });
    expect(velocity(sprints([30, 30, 30]), { ...learned, velocityMode: "manual" })).toMatchObject({ value: 20, source: "manual", perWeek: 15 });
    expect(velocity([], { ...learned, initialVelocity: null })).toMatchObject({ value: null, source: "initial" });
  });
});
