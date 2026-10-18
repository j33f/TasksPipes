import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import TokensSection from "./TokensSection.svelte";
import type { AccessToken } from "../lib/types";

let tokens: AccessToken[];
let calls: { method: string; url: string; body: unknown }[];
beforeEach(() => {
  calls = [];
  tokens = [{ id: "t1", name: "CI", prefix: "tp_abcdefg", scope: "read", expiresAt: "2027-01-01T00:00:00Z", lastUsedAt: null, createdAt: "2026-10-01T00:00:00Z", expired: false }];
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = method === "POST" ? { id: "t2", token: "tp_secretvalue" } : method === "DELETE" ? { ok: true } : tokens;
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("access tokens", () => {
  it("are listed by name and prefix, never by value, with a link to the API documentation", async () => {
    render(TokensSection, {});
    expect(await screen.findByText("CI")).toBeTruthy();
    expect(screen.getByText("tp_abcdefg…")).toBeTruthy();
    expect(screen.getByText("never used", { exact: false })).toBeTruthy();
    expect(screen.getByRole("link", { name: "API documentation" }).getAttribute("href")).toBe("/api/v1/docs");
  });

  it("are created with a scope and a lifetime, and shown once", async () => {
    render(TokensSection, {});
    await userEvent.type(screen.getByLabelText("Token name"), "Script");
    await userEvent.selectOptions(screen.getByLabelText("What the token may do"), "write");
    await userEvent.selectOptions(screen.getByLabelText("Valid for"), "365");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/me/tokens", body: { name: "Script", scope: "write", days: 365 } });
    expect(await screen.findByText("tp_secretvalue")).toBeTruthy();
    expect(screen.getByText("Copy this token now: it will not be shown again.")).toBeTruthy();
  });

  it("are revoked", async () => {
    render(TokensSection, {});
    await userEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/api/me/tokens/t1");
  });
});
