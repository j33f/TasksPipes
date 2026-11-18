import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import AgentsSection from "./AgentsSection.svelte";
import { app } from "../lib/app.svelte";
import type { AccessToken, SpaceSummary } from "../lib/types";

const space = (id: string, name: string, kind: "user" | "team"): SpaceSummary =>
  ({ id, kind, userId: null, name, description: "", color: null, avatarUrl: null, active: true, guest: false, myRole: "admin" }) as SpaceSummary;

let tokens: AccessToken[];
let calls: { method: string; url: string; body: unknown }[];
beforeEach(() => {
  calls = [];
  app.me = {
    user: { id: "u", name: "Alice", avatarUrl: null, email: "alice@example.com", kind: "outline", totp: false, locale: null, theme: null },
    personalSpaceId: "s1", outlineUrl: null, features: { invitations: true, notifications: false, mcp: true },
  } as never;
  app.spaces = [space("s1", "Alice", "user"), space("team1", "Design", "team")];
  tokens = [
    { id: "p1", name: "CI", prefix: "tp_personal", scope: "write", kind: "personal", scopes: [], spaceIds: null, expiresAt: "2027-01-01T00:00:00Z", lastUsedAt: null, createdAt: "2026-10-01T00:00:00Z", expired: false },
    { id: "a1", name: "Claude", prefix: "tp_agent00", scope: "write", kind: "agent", scopes: ["tasks:read", "tasks:send"], spaceIds: ["team1"], expiresAt: "2027-01-01T00:00:00Z", lastUsedAt: null, createdAt: "2026-10-01T00:00:00Z", expired: false },
  ];
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = method === "POST" ? { id: "a2", token: "tp_agentsecret" } : method === "DELETE" ? { ok: true } : tokens;
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  app.me = undefined;
  app.spaces = [];
});

describe("AI agents", () => {
  it("lists agent tokens only, with what they may do and where", async () => {
    render(AgentsSection, {});
    expect(await screen.findByText("Claude")).toBeTruthy();
    expect(screen.queryByText("CI")).toBeNull();
    expect(screen.getByText("Sends tasks to others")).toBeTruthy();
    expect(screen.queryByText("Creates and changes tasks")).toBeNull();
    expect(screen.getByText("Design", { exact: false })).toBeTruthy();
    expect(screen.getByText(`${location.origin}/mcp`)).toBeTruthy();
  });

  it("are connected read-only and everywhere unless more is chosen", async () => {
    render(AgentsSection, {});
    await userEvent.type(screen.getByLabelText("Agent name"), "Cursor");
    await userEvent.click(screen.getByRole("button", { name: "Connect an agent" }));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      url: "/api/me/tokens", body: { name: "Cursor", kind: "agent", scopes: [], days: 30 },
    });
    expect((calls.find((c) => c.method === "POST")!.body as object)).not.toHaveProperty("spaceIds");
    // Shown once, with a command to paste.
    expect(await screen.findByText("tp_agentsecret")).toBeTruthy();
    expect(screen.getByText(/claude mcp add --transport http taskspipes .*\/mcp --header "Authorization: Bearer tp_agentsecret"/)).toBeTruthy();
  });

  it("can be limited to chosen spaces and given more scopes", async () => {
    render(AgentsSection, {});
    await userEvent.type(screen.getByLabelText("Agent name"), "Claude");
    await userEvent.click(screen.getByLabelText("Create and change tasks"));
    await userEvent.click(screen.getByLabelText("Comment"));
    await userEvent.click(screen.getByLabelText("Only these:"));
    const connect = screen.getByRole("button", { name: "Connect an agent" });
    expect((connect as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByLabelText("Design"));
    await userEvent.click(connect);
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({ scopes: ["tasks:write", "comments:write"], spaceIds: ["team1"] });
  });

  it("are disconnected after confirming", async () => {
    render(AgentsSection, {});
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/api/me/tokens/a1");
  });
});
