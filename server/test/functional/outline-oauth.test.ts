import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { agent, startApp, stopApp } from "./helpers.js";
import { overrideSetting } from "../../src/settings-store.js";

let app: FastifyInstance;

/** Starts a sign-in with Outline, carrying the browser's cookie; returns the state and the cookie after it. */
async function start(cookie = "") {
  const res = await app.inject({ method: "GET", url: "/auth/outline", headers: cookie ? { cookie } : {} });
  const flows = res.cookies.find((c) => c.name === "tp_oauth_state")!;
  return { state: new URL(res.headers.location as string).searchParams.get("state")!, cookie: `tp_oauth_state=${flows.value}` };
}

/** Outline sends the person back with a code (the mock takes a token as code). */
async function back(state: string, cookie: string, extra = "") {
  const res = await app.inject({ method: "GET", url: `/auth/outline/callback?code=alice-token&state=${state}${extra}`, headers: { cookie } });
  const session = res.cookies.find((c) => c.name === "tp_session");
  const flows = res.cookies.find((c) => c.name === "tp_oauth_state");
  return { location: res.headers.location as string, session: session?.value, cookie: flows ? `tp_oauth_state=${flows.value}` : cookie };
}

beforeAll(async () => {
  app = await startApp();
  overrideSetting("outline.oauthClientId", "tasks-pipes");
  overrideSetting("outline.oauthClientSecret", "secret");
});
afterAll(async () => {
  overrideSetting("outline.oauthClientId", undefined);
  overrideSetting("outline.oauthClientSecret", undefined);
  await stopApp();
});

describe("sign-in with Outline (OAuth)", () => {
  it("signs in when Outline sends the person back", async () => {
    const s = await start();
    const r = await back(s.state, s.cookie);
    expect(r.location).toBe("/");
    expect((await agent(`tp_session=${r.session}`).get("/api/me")).body.user.name).toBe("Alice Martin");
  });

  it("keeps sign-ins started in other tabs: each comes back in turn", async () => {
    const first = await start();
    const second = await start(first.cookie);
    const r1 = await back(first.state, second.cookie);
    expect(r1.session).toBeTruthy();
    const r2 = await back(second.state, r1.cookie);
    expect(r2.session).toBeTruthy();
  });

  it("refuses a state this browser did not start, or one already used", async () => {
    const s = await start();
    const other = await start();
    const forged = await back(other.state, s.cookie);
    expect(forged.session).toBeUndefined();
    expect(decodeURIComponent(forged.location)).toBe("/login?error=Sign-in expired or interrupted, please try again.");
    const used = await back(s.state, s.cookie);
    expect(used.session).toBeTruthy();
    const again = await back(s.state, used.cookie);
    expect(again.session).toBeUndefined();
    expect(again.location).toMatch(/^\/login\?error=/);
  });

  it("sends an already signed-in person home when the return is played again", async () => {
    const s = await start();
    const r = await back(s.state, s.cookie);
    const replay = await back(s.state, `${s.cookie}; tp_session=${r.session}`);
    expect(replay.location).toBe("/");
  });

  it("shows the sign-in page with the error, never a raw one", async () => {
    const s = await start();
    const denied = await back(s.state, s.cookie, "&error=access_denied");
    expect(denied.location).toBe("/login?error=access_denied");
    overrideSetting("outline.oauthClientId", "");
    const off = await app.inject({ method: "GET", url: "/auth/outline" });
    overrideSetting("outline.oauthClientId", "tasks-pipes");
    expect(off.statusCode).toBe(302);
    expect(decodeURIComponent(off.headers.location as string)).toBe("/login?error=OAuth is not set up");
  });
});
