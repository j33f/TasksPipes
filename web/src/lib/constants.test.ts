import { afterEach, describe, expect, it, vi } from "vitest";
import { colorFor, dueState, formatDate, initials, localDay, moved, openTaskCount, relativeTime } from "./constants";
import { prefs } from "./i18n.svelte";

afterEach(() => {
  vi.useRealTimers();
  prefs.set({ locale: null });
});

describe("helpers", () => {
  it("move list items one step, within bounds", () => {
    expect(moved(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moved(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });

  it("count open tasks only", () => {
    expect(openTaskCount({ backlog: 2, ongoing: 1, done: 5, abandoned: 3 })).toBe(3);
  });

  it("make initials and stable colours", () => {
    expect(initials("Alice Martin")).toBe("AM");
    expect(initials("cher")).toBe("C");
    expect(colorFor("x")).toBe(colorFor("x"));
  });
});

describe("dates", () => {
  it("flag late and soon due dates of open tasks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T10:00:00"));
    expect(localDay()).toBe("2026-10-16");
    expect(dueState("2026-10-15", "ongoing")).toBe("overdue");
    expect(dueState("2026-10-18", "ongoing")).toBe("soon");
    expect(dueState("2026-10-30", "ongoing")).toBe("");
    expect(dueState("2026-10-15", "done")).toBe("");
  });

  it("format dates and relative times in the current language", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T10:00:00"));
    prefs.set({ locale: "fr" });
    expect(formatDate("2026-10-20")).toBe("20 oct.");
    expect(formatDate("2025-10-20")).toBe("20 oct. 2025");
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("il y a 5 min");
    prefs.set({ locale: "en" });
    expect(formatDate("2026-10-20")).toBe("20 Oct");
    expect(relativeTime(new Date().toISOString())).toBe("just now");
    expect(relativeTime(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe("3 d ago");
  });
});
