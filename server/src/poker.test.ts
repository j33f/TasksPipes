import { describe, expect, it } from "vitest";
import { pokerStats } from "./poker.js";

describe("the cards shown", () => {
  it("give their spread, median and a value of the scale to suggest", () => {
    expect(pokerStats(["3", "5", "8", "?"])).toEqual({ count: 3, min: 3, max: 8, median: 5, suggestion: 5, consensus: false });
    // Between 5 and 8: rounded up to the scale.
    expect(pokerStats(["5", "8"])).toMatchObject({ median: 6.5, suggestion: 8 });
    expect(pokerStats(["13", "13"])).toMatchObject({ consensus: true, suggestion: 13 });
    expect(pokerStats(["13", "13", "coffee"]).consensus).toBe(false);
    expect(pokerStats(["?", "coffee"])).toMatchObject({ count: 0, suggestion: null });
  });
});
