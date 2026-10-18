import { describe, expect, it } from "vitest";
import { highlight, isSearchShortcut } from "./search";

describe("search excerpts", () => {
  it("split into plain and matched text", () => {
    expect(highlight("before \u0002word\u0003 after")).toEqual([
      { text: "before ", mark: false }, { text: "word", mark: true }, { text: " after", mark: false },
    ]);
  });

  it("keep markup as plain text and drop stray marks", () => {
    expect(highlight("<b>\u0002x\u0003</b>\u0002")).toEqual([
      { text: "<b>", mark: false }, { text: "x", mark: true }, { text: "</b>", mark: false },
    ]);
  });
});

describe("search shortcut", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
  it("is Ctrl + K or ⌘ + K", () => {
    expect(isSearchShortcut(key({ key: "k", ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(key({ key: "K", metaKey: true }))).toBe(true);
    expect(isSearchShortcut(key({ key: "k" }))).toBe(false);
    expect(isSearchShortcut(key({ key: "k", ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});
