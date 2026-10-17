import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, signInWithLink, startApp, stopApp, agent, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";
import { createLoginLink, disableUnusedInvitations } from "../../src/auth.js";

let alice: Agent, bob: Agent;
let bobId: string;

/** Invites an address and returns the new account's id and sign-in link. */
async function invite(by: Agent, email: string, body: Record<string, unknown> = {}) {
  const res = await by.post("/api/invitations", { email, name: email.split("@")[0], ...body });
  expect(res.body).toMatchObject({ created: true, sent: false });
  const { rows: [u] } = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  return { id: u.id as string, link: res.body.link as string };
}

/** Makes an invitation older than 48 hours, its link expired. */
async function age(userId: string) {
  await pool.query(`UPDATE users SET created_at = now() - interval '49 hours' WHERE id = $1`, [userId]);
  await pool.query(`UPDATE login_tokens SET expires_at = now() - interval '1 hour' WHERE user_id = $1`, [userId]);
}

const disabled = async (userId: string) => Boolean((await pool.query(`SELECT disabled_at FROM users WHERE id = $1`, [userId])).rows[0].disabled_at);
const peopleOf = async (a: Agent) => ((await a.get("/api/users")).body as { id: string }[]).map((u) => u.id);

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  bobId = (await bob.get("/api/me")).body.user.id;
});
afterAll(stopApp);

describe("invitations not used within 48 hours", () => {
  it("give a link valid 48 hours", async () => {
    const { id } = await invite(alice, "x48@example.com");
    const { rows: [t] } = await pool.query(`SELECT extract(epoch FROM expires_at - created_at)::int AS s FROM login_tokens WHERE user_id = $1`, [id]);
    expect(Math.abs(t.s - 48 * 3600)).toBeLessThan(60);
  });

  it("are kept while the link is valid or the account is recent", async () => {
    const recent = await invite(alice, "recent@example.com");
    await pool.query(`UPDATE login_tokens SET expires_at = now() - interval '1 hour' WHERE user_id = $1`, [recent.id]);
    const linked = await invite(alice, "linked@example.com");
    await pool.query(`UPDATE users SET created_at = now() - interval '49 hours' WHERE id = $1`, [linked.id]);
    await disableUnusedInvitations();
    expect([await disabled(recent.id), await disabled(linked.id)]).toEqual([false, false]);
  });

  it("disable the account: hidden everywhere, its links refused, not assignable", async () => {
    const team = (await alice.post("/api/spaces", { name: "Expiring team", members: [{ userId: bobId }] })).body.id;
    const { id } = await invite(alice, "late@example.com", { teamId: team });
    const space = (await pool.query(`SELECT id FROM spaces WHERE user_id = $1`, [id])).rows[0].id;
    expect(await peopleOf(alice)).toContain(id);
    await age(id);
    expect(await disableUnusedInvitations()).toBeGreaterThanOrEqual(1);
    expect(await disabled(id)).toBe(true);

    expect(await peopleOf(alice)).not.toContain(id);
    expect(((await alice.get("/api/spaces")).body as { id: string }[]).map((s) => s.id)).not.toContain(space);
    const members = ((await alice.get(`/api/spaces/${team}`)).body.members as { id: string }[]).map((m) => m.id);
    expect(members).not.toContain(id);
    expect((await alice.post("/api/tasks", { title: "To them", spaceId: space })).status).toBe(404);
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Expiring board" })).body.id;
    expect((await alice.post("/api/tasks", { title: "Theirs", pipeId: pipe, assigneeId: id })).status).toBe(400);

    // Even a link made afterwards does not sign them in.
    const link = await createLoginLink(id, 60);
    const res = await agent().post("/api/auth/magic", { token: new URL(link).searchParams.get("token") });
    expect(res.status).toBe(400);

    // Their inviter sees the invitation as expired.
    const mine = ((await alice.get("/api/invitations")).body as { id: string; expired: boolean }[]).find((i) => i.id === id);
    expect(mine).toMatchObject({ expired: true });
  });

  it("come back with a new link from the inviter", async () => {
    const { id } = await invite(alice, "again@example.com");
    await age(id);
    await disableUnusedInvitations();
    const res = await alice.post(`/api/invitations/${id}/resend`);
    expect(res.body).toMatchObject({ sent: false, link: expect.any(String) });
    expect(await disabled(id)).toBe(false);
    expect(await peopleOf(alice)).toContain(id);
    const guest = await signInWithLink(res.body.link);
    expect((await guest.get("/api/me")).body.user.id).toBe(id);
    // Signed in once: never disabled afterwards.
    await age(id);
    await disableUnusedInvitations();
    expect(await disabled(id)).toBe(false);
  });

  it("come back when someone invites the address again, without telling it had an account", async () => {
    const { id } = await invite(alice, "reinvited@example.com");
    await age(id);
    await disableUnusedInvitations();
    const res = await bob.post("/api/invitations", { email: "reinvited@example.com" });
    expect(res.body).toMatchObject({ created: true, sent: false, link: expect.any(String) });
    expect(await disabled(id)).toBe(false);
    expect(await peopleOf(bob)).toContain(id);
    await signInWithLink(res.body.link);
  });

  it("leave accounts made by signing up alone", async () => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (id, name, email, auth_kind, created_at) VALUES (gen_uuidv7(), 'Self', 'self@example.com', 'email', now() - interval '10 days') RETURNING id`
    );
    await disableUnusedInvitations();
    expect(await disabled(u.id)).toBe(false);
  });

  it("end the sessions of a disabled account", async () => {
    const { id, link } = await invite(alice, "session@example.com");
    const guest = await signInWithLink(link);
    expect((await guest.get("/api/me")).status).toBe(200);
    await pool.query(`UPDATE users SET disabled_at = now(), disabled_reason = 'unused_invitation' WHERE id = $1`, [id]);
    expect((await guest.get("/api/me")).status).toBe(401);
    await pool.query(`UPDATE users SET disabled_at = NULL, disabled_reason = NULL WHERE id = $1`, [id]);
  });
});
