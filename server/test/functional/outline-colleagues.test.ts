import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { notificationState, runNotifications } from "../../src/notifications.js";
import { query } from "../../src/db.js";

// Dave is in the Outline workspace (imported when Alice signs in) but never signed in to TasksPipes.
const DAVE = "44444444-4444-4444-8444-444444444444";
let alice: Agent, bob: Agent, daveSpace: string, alicePipe: string;

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  const users = (await alice.get("/api/users")).body as { id: string; spaceId: string; active: boolean }[];
  const dave = users.find((u) => u.id === DAVE)!;
  expect(dave.active).toBe(false);
  daveSpace = dave.spaceId;
  alicePipe = (await alice.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
});
afterAll(async () => {
  // The last test signs Dave in; the suite shares one database, so undo it and leave him as imported —
  // never signed in — for whichever file runs next (mentions.test.ts asserts he cannot be mentioned).
  await query(`UPDATE users SET last_login_at = NULL WHERE id = $1`, [DAVE]);
  await stopApp();
});

describe("Outline colleagues who never signed in", () => {
  const notYet = "Dave Leroy has not signed in to TasksPipes yet: invite them first.";

  it("get no task", async () => {
    const res = await alice.post("/api/tasks", { title: "For Dave", spaceId: daveSpace });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(notYet);
    const id = (await alice.post("/api/tasks", { title: "Mine", pipeId: alicePipe })).body.id;
    expect((await alice.post(`/api/tasks/${id}/send`, { spaceId: daveSpace })).body.error).toBe(notYet);
  });

  it("join no team and own none of its tasks", async () => {
    const created = await alice.post("/api/spaces", { name: "With Dave", members: [{ userId: DAVE }] });
    expect(created.body.error).toBe(notYet);
    const team = (await alice.post("/api/spaces", { name: "Without Dave", members: [] })).body.id;
    expect((await alice.post(`/api/spaces/${team}/members`, { userId: DAVE })).body.error).toBe(notYet);
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Board" })).body.id;
    expect((await alice.post("/api/tasks", { title: "x", pipeId: pipe, assigneeId: DAVE })).body.error).toBe(notYet);
  });

  it("are told in their language, which here is the asker's", async () => {
    const fr = await signIn("alice-token", "fr");
    expect((await fr.post("/api/tasks", { title: "x", spaceId: daveSpace })).body.error)
      .toBe("Dave Leroy ne s'est pas encore connecté·e à TasksPipes : invitez cette personne d'abord.");
  });

  it("can be invited: without e-mail, the link to give them", async () => {
    const res = await alice.post(`/api/users/${DAVE}/invite`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: false, link: expect.stringMatching(/^https?:\/\//) });
  });

  it("cannot be invited when already on TasksPipes, nor when unknown", async () => {
    const bobId = (await bob.get("/api/me")).body.user.id;
    expect((await alice.post(`/api/users/${bobId}/invite`)).body.error).toBe("Bob Durand already uses TasksPipes.");
    // Someone one cannot see gets the same answer as an id that exists nowhere.
    const stranger = await alice.post("/api/users/00000000-0000-4000-8000-000000000999/invite");
    expect(stranger.status).toBe(400);
    expect(stranger.body.error).toBe("Unknown user");
  });

  it("get no e-mail notification", async () => {
    // A team with Bob: Dave cannot be in it, so check the e-mail rule on the history of a task Dave authored long ago.
    const { pool } = await import("../../src/db.js");
    notificationState.enabled = true;
    const task = (await alice.post("/api/tasks", { title: "Dave was here", pipeId: alicePipe })).body.id;
    await pool.query(`UPDATE tasks SET author_id = $2 WHERE id = $1`, [task, DAVE]);
    await alice.post(`/api/tasks/${task}/comments`, { body: "for the author" });
    const { rows } = await pool.query(`SELECT 1 FROM notifications WHERE user_id = $1`, [DAVE]);
    expect(rows).toEqual([]);
    const sent: string[] = [];
    await runNotifications(new Date(Date.now() + 3_600_000), async (m) => void sent.push(m.to));
    expect(sent).not.toContain("dave@example.com");
    notificationState.enabled = false;
  });

  it("take part once signed in", async () => {
    const dave = await signIn("dave-token");
    expect((await dave.get("/api/me")).body.user.id).toBe(DAVE);
    expect((await alice.post("/api/tasks", { title: "Now for Dave", spaceId: daveSpace })).status).toBe(200);
    expect((await alice.post(`/api/users/${DAVE}/invite`)).body.error).toBe("Dave Leroy already uses TasksPipes.");
  });
});
