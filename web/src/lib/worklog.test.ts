import { describe, expect, it } from "vitest";
import { durationInput, formatWork, parseDuration } from "./worklog";

describe("durations", () => {
  it("read the usual ways of writing them", () => {
    expect(parseDuration("2h30")).toBe(150);
    expect(parseDuration("2 h 30")).toBe(150);
    expect(parseDuration("1.5")).toBe(90);
    expect(parseDuration("1,5")).toBe(90);
    expect(parseDuration("3h")).toBe(180);
    expect(parseDuration("45min")).toBe(45);
    expect(parseDuration("45m")).toBe(45);
    for (const bad of ["", "abc", "0", "2h99x", "-1"]) expect(parseDuration(bad), bad).toBeNull();
  });

  it("show in hours, never in days", () => {
    expect(formatWork(45)).toBe("45 min");
    expect(formatWork(120)).toBe("2 h");
    expect(formatWork(26 * 60 + 30)).toBe("26 h 30");
    expect(durationInput(150)).toBe("2h30");
    expect(durationInput(120)).toBe("2h");
    expect(durationInput(null)).toBe("");
  });
});
