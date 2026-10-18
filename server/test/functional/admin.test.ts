import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signIn, signInWithLink, startApp, stopApp, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";
import { checkOutlineSessions, encrypt } from "../../src/auth.js";

// ADMIN_EMAILS (vitest.functional.config.ts): alice@example.com and admin-by-mail@example.com.
let app: FastifyInstance, alice: Agent, bob: Agent, carol: Agent, carolId: string;

beforeAll(async () => {
  app = await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  carolId = (await carol.get("/api/me")).body.user.id;
});
afterAll(stopApp);

describe("administrators", () => {
  it("are named by ADMIN_EMAILS, and the page is unknown to anyone else", async () => {
    expect((await alice.get("/api/me")).body.admin).toBe(true);
    expect((await bob.get("/api/me")).body.admin).toBe(false);
    const list = await alice.get("/api/admin/users");
    expect(list.status).toBe(200);
    expect(list.body.find((u: { name: string }) => u.name === "Carol Petit")).toMatchObject({ kind: "outline", disabled: null, admin: false });
    expect(list.body.find((u: { name: string }) => u.name === "Alice Martin").admin).toBe(true);
    // No system account in the list.
    expect(list.body.some((u: { name: string }) => u.name === "GitHub")).toBe(false);
    for (const req of [bob.get("/api/admin/users"), bob.post(`/api/admin/users/${carolId}/disable`)]) {
      const res = await req;
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Not found");
    }
  });

  it("include e-mail accounts with a listed address", async () => {
    const link = (await bob.post("/api/invitations", { email: "admin-by-mail@example.com", name: "Mail admin" })).body.link;
    const mailAdmin = await signInWithLink(link);
    expect((await mailAdmin.get("/api/me")).body.admin).toBe(true);
    expect((await mailAdmin.get("/api/admin/users")).status).toBe(200);
  });

  it("never include an account of another Outline server, whatever address it claims", async () => {
    // The same fake Outline under another address: another server for TasksPipes, with Alice's address.
    const elsewhere = await signIn("alice-token", "en", `http://127.0.0.1:${process.env.MOCK_OUTLINE_PORT}`);
    const me = (await elsewhere.get("/api/me")).body;
    expect(me.user.email).toBe("alice@example.com");
    expect(me.admin).toBe(false);
    expect((await elsewhere.get("/api/admin/users")).status).toBe(404);
  });
});

describe("disabling an account", () => {
  it("closes its sessions at once and refuses its sign-in, keeping its tasks", async () => {
    const bobId = (await bob.get("/api/me")).body.user.id;
    const team = (await alice.post("/api/spaces", { name: "Disabled member", members: [{ userId: carolId }, { userId: bobId }] })).body.id;
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Board" })).body.id;
    const task = (await carol.post("/api/tasks", { title: "By Carol", pipeId: pipe })).body.id;

    expect((await alice.post(`/api/admin/users/${carolId}/disable`)).status).toBe(200);
    expect((await carol.get("/api/me")).status).toBe(401);
    const again = await signIn("carol-token").catch((err: Error) => err.message);
    expect(again).toContain("This account is disabled on this instance.");

    // Tasks and history stay; the team shows the member as disabled; nobody can hand them a task.
    expect((await bob.get(`/api/tasks/${task}`)).body.author.name).toBe("Carol Petit");
    const members = (await bob.get(`/api/spaces/${team}`)).body.members;
    expect(members.find((m: { id: string }) => m.id === carolId)).toMatchObject({ disabled: true });
    expect((await bob.post("/api/tasks", { title: "x", pipeId: pipe, assigneeId: carolId })).status).toBe(400);
    const listed = (await alice.get("/api/admin/users")).body.find((u: { id: string }) => u.id === carolId);
    expect(listed.disabled).toMatchObject({ reason: "admin", by: "Alice Martin" });
  });

  it("is undone by enabling it", async () => {
    expect((await alice.post(`/api/admin/users/${carolId}/enable`)).status).toBe(200);
    carol = await signIn("carol-token");
    expect((await carol.get("/api/me")).status).toBe(200);
  });

  it("spares oneself and the other administrators", async () => {
    const aliceId = (await alice.get("/api/me")).body.user.id;
    expect((await alice.post(`/api/admin/users/${aliceId}/disable`)).body.error).toBe("You cannot disable your own account");
    const mailAdmin = (await alice.get("/api/admin/users")).body.find((u: { email: string }) => u.email === "admin-by-mail@example.com");
    expect((await alice.post(`/api/admin/users/${mailAdmin.id}/disable`)).status).toBe(400);
    expect((await alice.post("/api/admin/users/not-an-id/disable")).status).toBe(404);
  });
});

describe("Outline sessions", () => {
  it("are closed once Outline no longer accepts their token", async () => {
    const bobId = (await bob.get("/api/me")).body.user.id;
    await pool.query(`UPDATE sessions SET access_token = $2, refresh_token = NULL WHERE user_id = $1`, [bobId, encrypt("revoked-token")]);
    expect(await checkOutlineSessions()).toBeGreaterThanOrEqual(1);
    expect((await bob.get("/api/me")).status).toBe(401);
    // Others keep theirs.
    expect((await alice.get("/api/me")).status).toBe(200);
    void app;
  });
});
