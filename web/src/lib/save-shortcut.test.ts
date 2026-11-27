import { afterEach, describe, expect, it, vi } from "vitest";
import { isSaveShortcut, onSaveShortcut, saveButtonFor } from "./save-shortcut";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init });

afterEach(() => (document.body.innerHTML = ""));

describe("save shortcut", () => {
  it("is Ctrl + Enter or ⌘ + Enter, nothing else", () => {
    expect(isSaveShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isSaveShortcut(key({ metaKey: true }))).toBe(true);
    expect(isSaveShortcut(key({}))).toBe(false);
    expect(isSaveShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSaveShortcut(key({ ctrlKey: true, key: "s" }))).toBe(false);
  });

  it("submits the form the field is in", () => {
    document.body.innerHTML = `<form><textarea></textarea><button>Save</button></form>`;
    const form = document.querySelector("form")!;
    const submitted = vi.fn((e: Event) => e.preventDefault());
    form.addEventListener("submit", submitted);
    const field = document.querySelector("textarea")!;
    field.addEventListener("keydown", onSaveShortcut);
    const e = key({ ctrlKey: true });
    field.dispatchEvent(e);
    expect(submitted).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });

  it("presses the nearest button marked data-save outside a form", () => {
    document.body.innerHTML = `<div><button data-save id="a">A</button></div>
      <div id="block"><div><textarea></textarea></div><button data-save id="b">B</button></div>`;
    expect(saveButtonFor(document.querySelector("textarea"))?.id).toBe("b");
  });

  it("leaves a disabled save button alone", () => {
    document.body.innerHTML = `<form><input /><button disabled>Save</button></form>
      <div><textarea></textarea><button data-save disabled>Save</button></div>`;
    expect(saveButtonFor(document.querySelector("input"))).toBeNull();
    expect(saveButtonFor(document.querySelector("textarea"))).toBeNull();
  });

  it("does nothing where there is nothing to save", () => {
    document.body.innerHTML = `<div><textarea></textarea></div>`;
    expect(saveButtonFor(document.querySelector("textarea"))).toBeNull();
  });
});
