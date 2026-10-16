import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkServerVersion, update } from "./version.svelte";

const reload = vi.fn();

beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, reload });
  sessionStorage.clear();
  update.available = false;
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.unstubAllGlobals();
  reload.mockReset();
});

describe("checkServerVersion", () => {
  it("does nothing while the versions match or none is given", () => {
    checkServerVersion(__APP_VERSION__);
    checkServerVersion(null);
    expect(reload).not.toHaveBeenCalled();
    expect(update.available).toBe(false);
  });

  it("reloads at once when nothing is being edited", () => {
    checkServerVersion("99.0.0");
    expect(reload).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("tp:reloadedFor")).toBe("99.0.0");
  });

  it("only shows the banner while a dialog is open or a field focused", () => {
    document.body.innerHTML = '<div class="modal-backdrop"></div>';
    checkServerVersion("99.0.0");
    expect(reload).not.toHaveBeenCalled();
    expect(update.available).toBe(true);

    document.body.innerHTML = "<input id='x'>";
    (document.getElementById("x") as HTMLInputElement).focus();
    update.available = false;
    checkServerVersion("99.0.0");
    expect(reload).not.toHaveBeenCalled();
    expect(update.available).toBe(true);
  });

  it("does not reload twice for the same version (no loop)", () => {
    sessionStorage.setItem("tp:reloadedFor", "99.0.0");
    checkServerVersion("99.0.0");
    expect(reload).not.toHaveBeenCalled();
    expect(update.available).toBe(true);
  });
});
