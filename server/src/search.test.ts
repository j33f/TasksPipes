import { describe, expect, it } from "vitest";
import { prefixQuery, taskNumber } from "./search.js";

describe("search query", () => {
  it("makes each word a prefix that must match", () => {
    expect(prefixQuery("plan stage")).toBe("'plan':* & 'stage':*");
    expect(prefixQuery("Élève 2026")).toBe("'Élève':* & '2026':*");
  });

  it("keeps only letters and digits, so no query operator gets through", () => {
    expect(prefixQuery("a':* | !b & (c)")).toBe("'a' & 'b' & 'c'");
    expect(prefixQuery(" -!& ")).toBeNull();
    expect(prefixQuery("")).toBeNull();
  });

  it("limits the number and length of words", () => {
    expect(prefixQuery("w ".repeat(20))!.split(" & ")).toHaveLength(8);
    expect(prefixQuery("x".repeat(80))).toBe(`'${"x".repeat(50)}':*`);
  });

  it("reads task numbers", () => {
    expect(taskNumber("TP-123")).toBe(123);
    expect(taskNumber(" tp123 ")).toBe(123);
    expect(taskNumber("TP - 7")).toBe(7);
    expect(taskNumber("42")).toBe(42);
    expect(taskNumber("TP-12 plan")).toBeNull();
    expect(taskNumber("XY-12")).toBeNull();
  });
});
