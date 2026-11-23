import { describe, expect, it } from "vitest";
import { fold, prop } from "./calendar.js";

describe("iCalendar text", () => {
  it("escapes special characters", () => {
    expect(prop("SUMMARY", "a, b; c\\d\nnext")).toBe("SUMMARY:a\\, b\\; c\\\\d\\nnext");
  });

  it("escapes every line break, a lone carriage return included: no property can be slipped into the feed", () => {
    expect(prop("SUMMARY", "a\rURL:https://evil.example\r\nb\nc")).toBe("SUMMARY:a\\nURL:https://evil.example\\nb\\nc");
    expect(prop("SUMMARY", "a\rb")).not.toMatch(/[\r\n]/);
  });

  it("folds lines at 75 octets without splitting characters", () => {
    const line = `DESCRIPTION:${"é".repeat(100)}`;
    const folded = fold(line);
    for (const l of folded.split("\r\n")) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("leaves short lines alone", () => {
    expect(fold("SUMMARY:short")).toBe("SUMMARY:short");
  });
});
