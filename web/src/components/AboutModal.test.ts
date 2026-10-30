import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
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

  it("lets an administrator install it in one click, then follows the update", async () => {
    const calls: { method: string; url: string; body?: string }[] = [];
    vi.stubGlobal("confirm", () => true);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url, body: init?.body as string | undefined });
      const body = url === "/api/version"
        ? { current: "0.16.0", latest: { version: "0.17.0", url: "u" }, updateAvailable: true, canUpdate: true }
        : { ok: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }));
    render(AboutModal, { onclose: () => {} });
    await userEvent.click(await screen.findByRole("button", { name: "Update to 0.17.0" }));
    expect(calls).toContainEqual({ method: "POST", url: "/api/admin/update", body: '{"version":"0.17.0"}' });
    expect(await screen.findByText("Updating… the page reloads by itself once the new version is running.")).toBeTruthy();
  });

  it("offers no button to people who cannot update", async () => {
    serve({ current: "0.16.0", latest: { version: "0.17.0", url: "u" }, updateAvailable: true, canUpdate: false });
    render(AboutModal, { onclose: () => {} });
    await screen.findByText("Version 0.17.0 is available");
    expect(screen.queryByRole("button", { name: "Update to 0.17.0" })).toBeNull();
  });
});
