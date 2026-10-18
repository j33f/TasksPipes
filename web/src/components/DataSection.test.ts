import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import DataSection from "./DataSection.svelte";
import { app } from "../lib/app.svelte";
import { router } from "../lib/router.svelte";
import type { Me } from "../lib/types";

const me = (kind: "outline" | "email"): Me => ({
  user: { id: "u", name: "Gina", avatarUrl: null, email: "gina@example.com", kind, totp: kind === "email", locale: null, theme: null },
  personalSpaceId: "s",
  outlineUrl: "https://outline.test",
  features: { invitations: true, notifications: false },
});

let calls: { url: string; body: unknown }[];
let method = "totp";
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = url.endsWith("/delete/request") ? { method } : { ok: true };
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  app.me = undefined;
});

describe("your data", () => {
  it("can be downloaded by everyone; Outline accounts are not deleted here", () => {
    app.me = me("outline");
    render(DataSection, {});
    expect(screen.getByRole("link", { name: "Download my data" }).getAttribute("href")).toBe("/api/me/export");
    expect(screen.getByText("Your account comes from Outline: it cannot be deleted here.")).toBeTruthy();
    expect(screen.queryByText("Delete my account…")).toBeNull();
  });

  it("with two-factor authentication, the account is deleted after a warning and a code", async () => {
    app.me = me("email");
    method = "totp";
    render(DataSection, {});
    await userEvent.click(screen.getByText("Delete my account…"));
    expect(calls).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await userEvent.type(await screen.findByLabelText("Code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(calls.map((c) => c.url)).toEqual(["/api/me/delete/request", "/api/me/delete"]);
    expect(calls[1].body).toEqual({ code: "123456" });
    expect(app.me).toBeNull();
    expect(router.path).toBe("/login");
  });

  it("otherwise, a link is sent by e-mail", async () => {
    app.me = me("email");
    method = "email";
    render(DataSection, {});
    await userEvent.click(screen.getByText("Delete my account…"));
    await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(await screen.findByText("We sent you an e-mail: its link deletes your account. It is valid for 30 minutes.")).toBeTruthy();
  });
});
