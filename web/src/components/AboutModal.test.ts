import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import AboutModal from "./AboutModal.svelte";

const serve = (body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("About", () => {
  it("tells of a newer version, with its release notes", async () => {
    serve({ current: "0.16.0", latest: { version: "0.17.0", url: "https://github.com/j33f/TasksPipes/releases/tag/v0.17.0" }, updateAvailable: true });
    render(AboutModal, { onclose: () => {} });
    expect(await screen.findByText("Version 0.17.0 is available")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See what's new" }).getAttribute("href")).toBe("https://github.com/j33f/TasksPipes/releases/tag/v0.17.0");
  });

  it("says nothing when the instance is up to date", async () => {
    serve({ current: "0.16.0", latest: { version: "0.16.0", url: "u" }, updateAvailable: false });
    render(AboutModal, { onclose: () => {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
