import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { config } from "../../src/config.js";
import { decrypt } from "../../src/crypto-box.js";
import { pool } from "../../src/db.js";
import { refreshIdleOutlineConnections, runScheduledOutlineExports } from "../../src/outline-reports.js";
import { overrideSetting } from "../../src/settings-store.js";
import { addDays, dailyPeriod, localDay } from "../../src/time.js";

let app: FastifyInstance, alice: Agent, bob: Agent, team: string, pipe: string;
const day = addDays(localDay(new Date(), "UTC"), 40);

/** Starts connecting an Outline account for a pipe's publishing; returns the flow's state and cookie. */
async function connect(a: Agent, pipeId: string, body: object) {
  const res = await app.inject({
    method: "POST", url: `/api/pipes/${pipeId}/outline-export/connect`,
    headers: { cookie: a.cookie, "content-type": "application/json" }, payload: JSON.stringify(body),
  });
  const flows = res.cookies.find((c) => c.name === "tp_oauth_state");
  const json = res.json();
  return { status: res.statusCode, body: json, state: json.url ? new URL(json.url).searchParams.get("state")! : "", cookie: flows ? `tp_oauth_state=${flows.value}` : "" };
}

/** Outline sends the person back (the mock takes the connected person's token as code); returns where they land. */
async function back(a: Agent, flow: { state: string; cookie: string }, query = "code=gina-token") {
  const res = await app.inject({ method: "GET", url: `/auth/outline/callback?${query}&state=${flow.state}`, headers: { cookie: `${a.cookie}; ${flow.cookie}` } });
  const to = new URL(String(res.headers.location), "http://tasks.test");
  return to.pathname + (to.search ? `?${[...to.searchParams].map(([k, v]) => `${k}=${v}`).join("&")}` : "");
}

const settings = async () => (await alice.get(`/api/pipes/${pipe}/outline-export`)).body;
const stored = async () => (await pool.query(`SELECT * FROM pipe_outline_exports WHERE pipe_id = $1`, [pipe])).rows[0];
const expireToken = (ago = "1 hour") => pool.query(`UPDATE pipe_outline_exports SET token_expires_at = now() - $2::interval WHERE pipe_id = $1`, [pipe, ago]);

/** Publishes the pipe's daily activity of `d` (something happens on that day); returns the run. */
async function publishOn(d: string) {
  const end = dailyPeriod(d, 18, "UTC").end;
  await pool.query(`UPDATE task_events SET created_at = $2 WHERE task_id IN (SELECT id FROM tasks WHERE pipe_id = $1)`, [pipe, new Date(end.getTime() - 3600_000)]);
  return runScheduledOutlineExports(new Date(end.getTime() + 60_000));
}

const lastDocAuthor = async () => {
  const id = `doc-${(await settings()).lastExportUrl.match(/new-(\d+)$/)[1]}`;
  const res = await fetch(`${config.outlineApiUrl}/api/documents.info`, {
    method: "POST", headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" }, body: JSON.stringify({ id }),
  });
  return ((await res.json()) as { data: { createdBy: string } }).data.createdBy;
};

beforeAll(async () => {
  app = await startApp();
  overrideSetting("outline.oauthClientId", "tasks-pipes");
  overrideSetting("outline.oauthClientSecret", "secret");
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  const bobId = (await bob.get("/api/me")).body.user.id;
  team = (await alice.post("/api/spaces", { name: "Connected to Outline", members: [{ userId: bobId }] })).body.id;
  pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Connected", kind: "dev" })).body.id;
  const t = (await alice.post("/api/tasks", { title: "Work", pipeId: pipe })).body.id;
  await alice.patch(`/api/tasks/${t}`, { stage: "en_cours" });
});
afterAll(async () => {
  overrideSetting("outline.oauthClientId", undefined);
  overrideSetting("outline.oauthClientSecret", undefined);
  await stopApp();
});

describe("A pipe's publishing connected to an Outline account (OAuth)", () => {
  it("is offered only when OAuth is set up", async () => {
    expect((await alice.get("/api/me")).body.features.outlineConnect).toBe(true);
    overrideSetting("outline.oauthClientId", "");
    expect((await alice.get("/api/me")).body.features.outlineConnect).toBe(false);
    expect((await connect(alice, pipe, { parentDocumentId: "doc-1" })).body.error).toBe("OAuth is not set up");
    overrideSetting("outline.oauthClientId", "tasks-pipes");
  });

  it("saves the form's choices with the account once Outline sends the person back", async () => {
    expect((await connect(alice, pipe, {})).body.error).toBe("Choose the parent document in Outline");
    const flow = await connect(alice, pipe, { parentDocumentId: "doc-1", daily: true, sprints: false });
    expect(flow.body.url).toMatch(new RegExp(`^${config.outlineUrl}/oauth/authorize\\?`));
    expect(await settings()).toBeNull();
    expect(await back(alice, flow)).toBe(`/pipes/${pipe}?outline=connected`);
    expect(await settings()).toMatchObject({ connection: "oauth", outlineUser: "Gina Roux", parentDocId: "doc-1", daily: true, mine: true });
  });

  it("publishes with it, and renews the access token when it ends", async () => {
    const before = await stored();
    await expireToken();
    expect((await publishOn(day)).failed.filter((f) => f.pipeId === pipe)).toEqual([]);
    expect(await lastDocAuthor()).toBe("Gina Roux");
    const after = await stored();
    expect(decrypt(after.api_key)).toMatch(/^gina-token~\d+$/);
    expect(decrypt(after.refresh_token)).not.toBe(decrypt(before.refresh_token));
    expect(after.token_expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("renews once when two requests need it at the same time", async () => {
    await expireToken();
    const [a, b] = await Promise.all([
      alice.put(`/api/pipes/${pipe}/outline-export`, { sprints: true }),
      bob.put(`/api/pipes/${pipe}/outline-export`, { weekly: false }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await settings()).keyRefused).toBe(false);
  });

  it("keeps a connection unused for a week alive", async () => {
    await expireToken("8 days");
    const before = decrypt((await stored()).refresh_token);
    expect(await refreshIdleOutlineConnections()).toEqual([]);
    const after = await stored();
    expect(decrypt(after.refresh_token)).not.toBe(before);
    expect(after.token_expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("stops when Outline ended the connection, until the account is connected again", async () => {
    await fetch(`${config.outlineApiUrl}/test/revoke`, { method: "POST", body: JSON.stringify({ token: "gina-token", oauth: true }) });
    await expireToken("8 days");
    expect(await refreshIdleOutlineConnections()).toEqual([{ pipeId: pipe, message: "Invalid refresh token" }]);
    expect(await settings()).toMatchObject({ keyRefused: true, lastError: "Invalid refresh token" });
    expect((await publishOn(addDays(day, 1))).failed.filter((f) => f.pipeId === pipe)).toEqual([]);
    expect(await back(alice, await connect(alice, pipe, { parentDocumentId: "doc-2" }))).toBe(`/pipes/${pipe}?outline=connected`);
    expect(await settings()).toMatchObject({ keyRefused: false, lastError: null, parentDocId: "doc-2", connection: "oauth", daily: true });
  });

  it("takes only the return of the person who started it, and says when Outline was refused", async () => {
    const flow = await connect(alice, pipe, { parentDocumentId: "doc-1" });
    expect(await back(bob, flow)).toBe(`/pipes/${pipe}?outline_error=Action not allowed`);
    const denied = await connect(alice, pipe, { parentDocumentId: "doc-1" });
    expect(await back(alice, denied, "error=access_denied")).toBe(`/pipes/${pipe}?outline_error=access_denied`);
    expect((await settings()).parentDocId).toBe("doc-2");
    // Someone outside the space cannot start one.
    const carol = await signIn("carol-token");
    expect((await connect(carol, pipe, { parentDocumentId: "doc-1" })).status).toBe(404);
  });

  it("gives way to an API key", async () => {
    const res = await alice.put(`/api/pipes/${pipe}/outline-export`, { apiKey: "alice-token" });
    expect(res.body).toMatchObject({ connection: "key", outlineUser: "Alice Martin" });
    expect(await stored()).toMatchObject({ oauth: false, refresh_token: null, token_expires_at: null });
  });
});
