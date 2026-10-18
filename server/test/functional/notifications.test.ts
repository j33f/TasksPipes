import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, signIn, signInWithLink, startApp, stopApp, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";
import { UNSUBSCRIBE_LIMIT, notificationState, runNotifications, type Mail } from "../../src/notifications.js";
import { resetRate } from "../../src/rate-limit.js";
import { addDays, localDay } from "../../src/time.js";

let alice: Agent, bob: Agent, carol: Agent;
let ids: Record<"alice" | "bob" | "carol", string>;
let spaces: Record<"alice" | "bob" | "carol", string>;
const mails: Mail[] = [];

/** Runs the sending at a moment (minutes from now by default) and returns the e-mails that went out. */
async function run(at: Date | number = 3) {
  const before = mails.length;
  await runNotifications(typeof at === "number" ? new Date(Date.now() + at * 60_000) : at, async (m) => void mails.push(m));
  return mails.slice(before);
}
const to = (list: Mail[], who: string) => list.filter((m) => m.to === who);
const emailOf = async (a: Agent) => (await a.get("/api/me")).body.user.email as string;
const at = (day: string, time: string) => new Date(`${day}T${time}:00Z`);

beforeAll(async () => {
  await startApp();
  notificationState.enabled = true;
  [alice, bob, carol] = await Promise.all([signIn("alice-token"), signIn("bob-token"), signIn("carol-token")]);
  const me = await Promise.all([alice, bob, carol].map((a) => a.get("/api/me")));
  ids = { alice: me[0].body.user.id, bob: me[1].body.user.id, carol: me[2].body.user.id };
  spaces = { alice: me[0].body.personalSpaceId, bob: me[1].body.personalSpaceId, carol: me[2].body.personalSpaceId };
  // Whatever earlier files left pending is not about these tests.
  await run(60 * 24);
  mails.length = 0;
});
afterAll(async () => {
  notificationState.enabled = false;
  await stopApp();
});

describe("e-mail notifications", () => {
  it("are offered in the settings, with their defaults", async () => {
    const me = (await bob.get("/api/me")).body;
    expect(me.features.notifications).toBe(true);
    expect(me.notificationPrefs).toMatchObject({ received: "immediate", comment: "digest", due: "immediate", dueHour: 8 });
    expect((await bob.put("/api/me/notifications", { comment: "never" })).status).toBe(400);
  });

  it("tell someone a task arrived in their incoming, but not the sender", async () => {
    const id = (await alice.post("/api/tasks", { title: "Prepare the quote", spaceId: spaces.bob, comment: "For Monday" })).body.id;
    const sent = await run();
    const mine = to(sent, await emailOf(bob)).filter((m) => m.html.includes(id));
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toMatch(/^New task for you: TP-\d+ Prepare the quote$/);
    expect(mine[0].html).toContain("sent you this task: “For Monday”");
    expect(mine[0].headers["List-Unsubscribe"]).toMatch(/^<http:\/\/tasks\.test\/notifications\/unsubscribe\?/);
    expect(mine[0].headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(to(sent, await emailOf(alice))).toHaveLength(0);
  });

  it("are in the language of the person", async () => {
    await bob.patch("/api/me", { locale: "fr" });
    await alice.post("/api/tasks", { title: "Relancer", spaceId: spaces.bob });
    const [m] = to(await run(), await emailOf(bob));
    expect(m.subject).toMatch(/^Nouvelle tâche pour vous : TP-\d+ Relancer$/);
    expect(m.lang).toBe("fr");
    await bob.patch("/api/me", { locale: "en" });
  });

  it("wait a little, then group what happens to a task in one e-mail, at most every 15 minutes", async () => {
    await bob.put("/api/me/notifications", { comment: "immediate" });
    const id = (await alice.post("/api/tasks", { title: "Grouped", spaceId: spaces.bob })).body.id;
    expect(to(await run(0), await emailOf(bob)).filter((m) => m.html.includes(id))).toHaveLength(0);
    await alice.post(`/api/tasks/${id}/comments`, { body: "One more thing" });
    const [first, ...others] = to(await run(3), await emailOf(bob)).filter((m) => m.html.includes(id));
    expect(others).toHaveLength(0);
    expect(first.subject).toMatch(/^Activity on TP-\d+ Grouped$/);
    expect(first.html).toContain("One more thing");
    await alice.post(`/api/tasks/${id}/comments`, { body: "And another" });
    expect(to(await run(6), await emailOf(bob)).filter((m) => m.html.includes(id))).toHaveLength(0);
    const later = to(await run(20), await emailOf(bob)).filter((m) => m.html.includes(id));
    expect(later).toHaveLength(1);
    expect(later[0].html).toContain("And another");
    await bob.put("/api/me/notifications", { comment: "digest" });
  });

  it("tell the sender their task was refused, with the reason", async () => {
    const id = (await alice.post("/api/tasks", { title: "Not mine", spaceId: spaces.bob })).body.id;
    expect((await bob.post(`/api/tasks/${id}/refuse`, { reason: "Ask Carol" })).status).toBe(200);
    const [m] = to(await run(), await emailOf(alice)).filter((x) => x.html.includes(id));
    expect(m.subject).toMatch(/^Task refused: TP-\d+ Not mine$/);
    expect(m.html).toContain("refused this task: “Ask Carol”");
  });

  it("tell someone they own a task of a team", async () => {
    const team = (await alice.post("/api/spaces", { name: "Notified team", members: [{ userId: ids.bob }] })).body.id;
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Board" })).body.id;
    const id = (await alice.post("/api/tasks", { title: "Yours now", pipeId: pipe, assigneeId: ids.bob })).body.id;
    const [m] = to(await run(), await emailOf(bob)).filter((x) => x.html.includes(id));
    expect(m.subject).toMatch(/^You now own TP-\d+ Yours now$/);
    expect(m.html).toContain("Notified team › Board");
  });

  it("send comments in the daily digest, once", async () => {
    const team = (await alice.post("/api/spaces", { name: "Digest team", members: [{ userId: ids.carol }] })).body.id;
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Digest board" })).body.id;
    const id = (await alice.post("/api/tasks", { title: "Discussed", pipeId: pipe })).body.id;
    await carol.post(`/api/tasks/${id}/comments`, { body: "Looks good" });
    expect(to(await run(), await emailOf(alice)).filter((m) => m.html.includes(id))).toHaveLength(0);
    const evening = at(addDays(localDay(new Date(), "UTC"), 1), "18:30");
    const [digest, ...more] = to(await run(evening), await emailOf(alice)).filter((m) => m.html.includes(id));
    expect(more).toHaveLength(0);
    expect(digest.subject).toMatch(/^Your TasksPipes notifications — /);
    expect(digest.html).toContain("Looks good");
    expect(to(await run(new Date(evening.getTime() + 60_000)), await emailOf(alice)).filter((m) => m.html.includes(id))).toHaveLength(0);
  });

  it("are not sent when turned off", async () => {
    await bob.put("/api/me/notifications", { received: "off" });
    const id = (await alice.post("/api/tasks", { title: "Silent", spaceId: spaces.bob })).body.id;
    expect(to(await run(), await emailOf(bob)).filter((m) => m.html.includes(id))).toHaveLength(0);
    const { rows } = await pool.query(`SELECT channel, dropped_at FROM notifications WHERE task_id = $1`, [id]);
    expect(rows).toEqual([expect.objectContaining({ channel: "off", dropped_at: expect.any(Date) })]);
    await bob.put("/api/me/notifications", { received: "immediate" });
  });

  it("are not sent to people who lost access to the task meanwhile", async () => {
    const team = (await alice.post("/api/spaces", { name: "Leaving team", members: [{ userId: ids.bob }] })).body.id;
    const id = (await alice.post("/api/tasks", { title: "Team secret", spaceId: team })).body.id;
    expect((await alice.del(`/api/spaces/${team}/members/${ids.bob}`)).status).toBe(200);
    expect(to(await run(), await emailOf(bob)).filter((m) => m.html.includes(id))).toHaveLength(0);
    const { rows } = await pool.query(`SELECT channel FROM notifications WHERE task_id = $1 AND user_id = $2`, [id, ids.bob]);
    expect(rows).toEqual([{ channel: "no_access" }]);
  });

  it("only name confidential tasks by their key", async () => {
    const team = (await alice.post("/api/spaces", { name: "Follow-up team", members: [{ userId: ids.bob }] })).body.id;
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Learner Jane", kind: "suivi" })).body.id;
    const id = (await alice.post("/api/tasks", { title: "Jane is struggling", pipeId: pipe, assigneeId: ids.bob })).body.id;
    const [m] = to(await run(), await emailOf(bob)).filter((x) => x.html.includes(id));
    expect(m.subject).toMatch(/^You now own TP-\d+$/);
    expect(m.html).not.toContain("Jane");
  });

  it("are not sent to e-mail accounts that never signed in", async () => {
    const res = await alice.post("/api/invitations", { email: "never@example.com", name: "Never" });
    const { rows: [u] } = await pool.query(`SELECT u.id, s.id AS space_id FROM users u JOIN spaces s ON s.user_id = u.id WHERE u.email = 'never@example.com'`);
    const id = (await alice.post("/api/tasks", { title: "For a newcomer", spaceId: u.space_id })).body.id;
    expect((await pool.query(`SELECT 1 FROM notifications WHERE task_id = $1`, [id])).rowCount).toBe(0);
    // Once signed in, they do.
    await signInWithLink(res.body.link);
    const next = (await alice.post("/api/tasks", { title: "Welcome", spaceId: u.space_id })).body.id;
    expect(to(await run(), "never@example.com").filter((m) => m.html.includes(next))).toHaveLength(1);
  });
});

describe("due date reminders", () => {
  const day = addDays(localDay(new Date(), "UTC"), 10);

  it("come once in the morning, at each person's hour, overdue tasks only once", async () => {
    const personal = (await alice.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
    const soon = (await alice.post("/api/tasks", { title: "Due tomorrow", pipeId: personal, dueDate: addDays(day, 1) })).body.id;
    const late = (await alice.post("/api/tasks", { title: "Late one", pipeId: personal, dueDate: addDays(day, -2) })).body.id;
    const done = (await alice.post("/api/tasks", { title: "Done already", pipeId: personal, dueDate: day, status: "done" })).body.id;
    await alice.put("/api/me/notifications", { dueHour: 9 });

    expect(to(await run(at(day, "08:30")), await emailOf(alice)).filter((m) => m.subject.startsWith("Your due dates"))).toHaveLength(0);
    const [m, ...more] = to(await run(at(day, "09:05")), await emailOf(alice)).filter((x) => x.subject.startsWith("Your due dates"));
    expect(more).toHaveLength(0);
    expect(m.subject).toBe(`Your due dates — ${day}`);
    expect(m.html).toContain(soon);
    expect(m.html).toContain(late);
    expect(m.html).not.toContain(done);
    expect(to(await run(at(day, "11:00")), await emailOf(alice)).filter((x) => x.subject.startsWith("Your due dates"))).toHaveLength(0);

    const [next] = to(await run(at(addDays(day, 1), "09:05")), await emailOf(alice)).filter((x) => x.subject.startsWith("Your due dates"));
    expect(next.html).toContain(soon); // due today now
    expect(next.html).not.toContain(late); // told once
  });

  it("can be turned off", async () => {
    await alice.put("/api/me/notifications", { due: "off" });
    expect(to(await run(at(addDays(day, 2), "09:05")), await emailOf(alice)).filter((x) => x.subject.startsWith("Your due dates"))).toHaveLength(0);
    await alice.put("/api/me/notifications", { due: "immediate", dueHour: 8 });
  });
});

describe("unsubscribing", () => {
  const link = async () => {
    await alice.post("/api/tasks", { title: "Unsubscribe me", spaceId: spaces.bob });
    const [m] = to(await run(), await emailOf(bob));
    return new URL(m.headers["List-Unsubscribe"].slice(1, -1));
  };

  it("asks for a confirmation, then turns the e-mails off (one-click too)", async () => {
    const url = await link();
    const page = await agent().get(url.pathname + url.search);
    expect(page.status).toBe(200);
    expect(page.body).toContain('<form method="post"');
    expect((await bob.get("/api/me")).body.notificationPrefs.received).toBe("immediate");

    const app = await startApp();
    const res = await app.inject({
      method: "POST", url: url.pathname + url.search,
      headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "List-Unsubscribe=One-Click",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("You will no longer get e-mails about: Tasks received.");
    expect((await bob.get("/api/me")).body.notificationPrefs.received).toBe("off");
    await bob.put("/api/me/notifications", { received: "immediate" });
  });

  it("refuses forged links without telling anything about the account", async () => {
    const url = await link();
    url.searchParams.set("u", ids.carol);
    const forged = await agent().post(url.pathname + url.search);
    const unknown = await agent().post("/notifications/unsubscribe?u=0190a0b0-0000-7000-8000-000000000000&k=comment&s=x");
    expect([forged.status, unknown.status]).toEqual([400, 400]);
    expect(forged.body).toBe(unknown.body);
    expect((await carol.get("/api/me")).body.notificationPrefs.received).toBe("immediate");
  });

  it("is rate limited", async () => {
    const limit = UNSUBSCRIBE_LIMIT;
    await resetRate(limit, "127.0.0.1");
    const app = await startApp();
    const hit = () => app.inject({ method: "GET", url: "/notifications/unsubscribe?u=x&k=comment&s=x" });
    for (let i = 0; i < 20; i++) expect((await hit()).statusCode).toBe(400);
    const blocked = await hit();
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    await resetRate(limit, "127.0.0.1");
  });
});

describe("without e-mail", () => {
  it("are neither offered nor queued", async () => {
    notificationState.enabled = false;
    try {
      const me = (await bob.get("/api/me")).body;
      expect(me.features.notifications).toBe(false);
      expect(me.notificationPrefs).toBeUndefined();
      expect((await bob.put("/api/me/notifications", { comment: "off" })).status).toBe(404);
      const id = (await alice.post("/api/tasks", { title: "No SMTP", spaceId: spaces.bob })).body.id;
      expect((await pool.query(`SELECT 1 FROM notifications WHERE task_id = $1`, [id])).rowCount).toBe(0);
    } finally {
      notificationState.enabled = true;
    }
  });
});
