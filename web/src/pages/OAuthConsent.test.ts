import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { app } from "../lib/app.svelte";
import { router } from "../lib/router.svelte";
import type { SpaceSummary } from "../lib/types";

const leave = vi.fn();
vi.mock("../lib/leave", () => ({ leave: (url: string) => leave(url) }));
const { default: OAuthConsent } = await import("./OAuthConsent.svelte");

const space = (id: string, name: string, kind: "user" | "team"): SpaceSummary =>
  ({ id, kind, userId: null, name, description: "", color: null, avatarUrl: null, active: true, guest: false, myRole: "admin" }) as SpaceSummary;

let pending: object;
let calls: { method: string; url: string; body: unknown }[];
beforeEach(() => {
  calls = [];
  leave.mockReset();
  history.replaceState(null, "", "/oauth/consent?request=abc");
  router.sync();
  app.me = {
    user: { id: "u", name: "Alice", avatarUrl: null, email: "alice@example.com", kind: "outline", totp: false, locale: null, theme: null },
    personalSpaceId: "s1", outlineUrl: null, features: { invitations: true, notifications: false, mcp: true },
  } as never;
  app.spaces = [space("s1", "Alice", "user"), space("team1", "Design", "team")];
  pending = { client: { name: "Claude", verified: false, url: null, redirectHost: "claude.ai" }, scopes: ["tasks:read", "tasks:write"] };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = method === "GET" ? pending : { redirect: url.endsWith("/deny") ? "https://claude.ai/cb?error=access_denied" : "https://claude.ai/cb?code=xyz" };
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  app.me = undefined;
  app.spaces = [];
});

describe("OAuth consent", () => {
  it("shows who asks, that its name is unverified, and where it sends back", async () => {
    render(OAuthConsent, {});
    expect(await screen.findByText(/“Claude” asks to work on your tasks/)).toBeTruthy();
    expect(screen.getByText("unverified name")).toBeTruthy();
    expect(screen.getByText("claude.ai")).toBeTruthy();
    expect(calls[0].url).toBe("/api/oauth/requests/abc");
  });

  it("ticks what the application asked for, and sends what the person chose", async () => {
    render(OAuthConsent, {});
    const write = (await screen.findByLabelText("Create and change tasks")) as HTMLInputElement;
    expect(write.checked).toBe(true);
    expect((screen.getByLabelText("Comment") as HTMLInputElement).checked).toBe(false);
    await userEvent.click(screen.getByLabelText("Only these:"));
    expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByLabelText("Design"));
    await userEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      url: "/api/oauth/requests/abc/approve", body: { scopes: ["tasks:write"], spaceIds: ["team1"] },
    });
    expect(leave).toHaveBeenCalledWith("https://claude.ai/cb?code=xyz");
  });

  it("sends the refusal back to the application", async () => {
    render(OAuthConsent, {});
    await userEvent.click(await screen.findByRole("button", { name: "Refuse" }));
    expect(calls.find((c) => c.method === "POST")?.url).toBe("/api/oauth/requests/abc/deny");
    expect(leave).toHaveBeenCalledWith("https://claude.ai/cb?error=access_denied");
  });
});
