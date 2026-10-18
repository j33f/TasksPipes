import { describe, expect, it } from "vitest";
import { cleanPriority } from "./labels.js";

describe("priority", () => {
  it("is 1 to 4, or none", () => {
    expect([1, 2, 3, 4].map(cleanPriority)).toEqual([1, 2, 3, 4]);
    expect([null, undefined, ""].map(cleanPriority)).toEqual([null, null, null]);
    for (const v of [0, 5, 2.5, "2", "high"]) expect(() => cleanPriority(v)).toThrow("Invalid priority");
  });
});
