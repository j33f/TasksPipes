import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import Admin from "./Admin.svelte";
import { app } from "../lib/app.svelte";
import type { AdminUser } from "../lib/types";

const user = (over: Partial<AdminUser>): AdminUser => ({
  id: "u", name: "Someone", email: "someone@example.com", kind: "outline", outlineUrl: "https://docs.example.com",
  lastLoginAt: null, createdAt: "2026-01-01T00:00:00Z", disabled: null, admin: false, ...over,
});

let users: AdminUser[];
let calls: string[];
beforeEach(() => {
  calls = [];
  users = [
    user({ id: "a", name: "Alice", admin: true }),
    user({ id: "c", name: "Carol", lastLoginAt: new Date().toISOString() }),
    user({ id: "g", name: "Gina", kind: "email", outlineUrl: null, disabled: { at: "2026-02-01T00:00:00Z", reason: "admin", by: "Alice" } }),
  ];
  app.me = { user: { id: "a", name: "Alice", avatarUrl: null, email: null, kind: "outline", totp: false, locale: null, theme: null },
    personalSpaceId: "s", outlineUrl: "", admin: true, features: { invitations: true, notifications: false } };
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify(url.endsWith("/admin/users") ? users : { ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  app.me = undefined;
});

describe("administration page", () => {
  it("lists the accounts, without actions on oneself or administrators", async () => {
    render(Admin, {});
    expect(await screen.findByText("Carol")).toBeTruthy();
    expect(screen.getByText(/^Disabled on .+ by Alice$/)).toBeTruthy();
    // Alice is an administrator (and oneself): no button; Carol can be disabled, Gina enabled.
    expect(screen.getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Disable", "Enable"]);
  });

  it("disables and enables accounts", async () => {
    render(Admin, {});
    await userEvent.click(await screen.findByRole("button", { name: "Disable" }));
    await userEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual(["POST /api/admin/users/c/disable", "POST /api/admin/users/g/enable"]);
  });

  it("has a tab for the backups, marked when something is wrong with them", async () => {
    const backups = { plan: null, last: null, lastOk: null, runs: [], problem: "failed" };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/admin/backups") ? backups : users), { status: 200, headers: { "content-type": "application/json" } })));
    render(Admin, {});
    const tab = await screen.findByRole("tab", { name: /Backups/ });
    expect(await screen.findByTitle("Something is wrong with the backups")).toBeTruthy();
    await userEvent.click(tab);
    expect(location.search).toBe("?tab=backups");
    expect(screen.getByRole("alert").textContent).toContain("The last backup failed.");
  });
});
