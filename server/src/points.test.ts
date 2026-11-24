import { describe, expect, it } from "vitest";
import { POINTS, cleanPoints, roundPoints } from "./points.js";

describe("points", () => {
  it("are a value of the planning poker scale, or none", () => {
    expect(POINTS.map(cleanPoints)).toEqual([...POINTS]);
    expect([null, undefined, ""].map(cleanPoints)).toEqual([null, null, null]);
    for (const v of [4, -1, 2.5, 200, "3", "big"]) expect(() => cleanPoints(v)).toThrow("Invalid points");
  });

  it("round other numbers up to the scale", () => {
    expect([0, 0.5, 1, 4, 6, 20, 34, 99, 150].map(roundPoints)).toEqual([0, 1, 1, 5, 8, 21, 40, 100, 100]);
    expect([-1, NaN, Infinity].map(roundPoints)).toEqual([undefined, undefined, undefined]);
  });
});
