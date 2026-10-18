import { describe, expect, it } from "vitest";
import { cleanDay, cleanEstimate, cleanMinutes, cleanNote } from "./worklog.js";

describe("logged time", () => {
  it("is from 1 minute to a day per entry", () => {
    expect(cleanMinutes(90)).toBe(90);
    for (const v of [0, 1441, 1.5, "60", null]) expect(() => cleanMinutes(v)).toThrow("Logged time is from 1 minute to 24 hours");
  });

  it("is logged for today by default, or a day of the last 90 days", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    expect(cleanDay(undefined, now)).toBe("2026-10-18");
    expect(cleanDay("2026-07-20", now)).toBe("2026-07-20");
    for (const v of ["2026-10-19", "2026-07-19", "yesterday"]) expect(() => cleanDay(v, now)).toThrow("Log time for a day of the last {n} days");
  });

  it("has an estimate in whole minutes, up to 1,000 hours, or none", () => {
    expect(cleanEstimate(150)).toBe(150);
    expect([null, undefined, ""].map(cleanEstimate)).toEqual([null, null, null]);
    for (const v of [0, 60001, 2.5, "2h"]) expect(() => cleanEstimate(v)).toThrow("Invalid estimate");
    expect(cleanNote("  ok ")).toBe("ok");
    expect(() => cleanNote("x".repeat(501))).toThrow();
  });
});
