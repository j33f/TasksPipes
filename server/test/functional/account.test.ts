import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { agent, signIn, signInWithLink, startApp, stopApp, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";
import { deletionMail } from "../../src/account.js";
import { codeAt } from "../../src/totp.js";
import { readZip } from "../zip-reader.js";

let app: FastifyInstance, alice: Agent, bob: Agent, aliceId: string, bobId: string;

const download = async (cookie: string) => {
  const res = await app.inject({ method: "GET", url: "/api/me/export", headers: { cookie } });
  return { res, files: res.statusCode === 200 ? readZip(res.rawPayload) : new Map<string, Buffer>() };
};
/** A new e-mail account, invited by Bob. */
const guest = async (email: string, name: string) => {
  const g = await signInWithLink((await bob.post("/api/invitations", { email, name })).body.link);
  return { g, id: (await g.get("/api/me")).body.user.id as string, space: (await g.get("/api/me")).body.personalSpaceId as string };
};

beforeAll(async () => {
  app = await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  aliceId = (await alice.get("/api/me")).body.user.id;
  bobId = (await bob.get("/api/me")).body.user.id;
});
afterAll(stopApp);

describe("data export", () => {
  it("holds one's profile, tasks, comments and files, in a zip", async () => {
    const pipe = (await alice.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
    const task = (await alice.post("/api/tasks", { title: "Exported task", pipeId: pipe, items: ["A sub-task"] })).body.id;
    await alice.post(`/api/tasks/${task}/comments`, { body: "My exported comment" });
    await pool.query(
      `INSERT INTO task_files (task_id, field, name, mime, size, content, uploaded_by) VALUES ($1, 'f', 'notes.txt', 'text/plain', 5, $2, $3)`,
      [task, Buffer.from("hello"), aliceId]
    );
    const { res, files } = await download(alice.cookie);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="taskspipes-export-\d{4}-\d{2}-\d{2}\.zip"$/);
    const data = JSON.parse(files.get("data.json")!.toString());
    expect(data.profile).toMatchObject({ name: "Alice Martin", email: "alice@example.com", kind: "outline" });
    const t = data.tasks.find((x: { title: string }) => x.title === "Exported task");
    expect(t.history.map((e: { type: string }) => e.type)).toEqual(["created", "comment"]);
    expect(t.files).toHaveLength(1);
    expect(files.get(t.files[0].path)!.toString()).toBe("hello");
    expect(data.comments.find((c: { text: string }) => c.text === "My exported comment").task).toMatchObject({ title: "Exported task" });
  });

  it("leaves out tasks one can no longer see, keeping only one's own comments on them", async () => {
    const team = (await bob.post("/api/spaces", { name: "Left team", members: [{ userId: aliceId }] })).body.id;
    const pipe = (await bob.post(`/api/spaces/${team}/pipes`, { name: "Board" })).body.id;
    // Written by Bob: once out of the team, Alice no longer sees it (an author would).
    const task = (await bob.post("/api/tasks", { title: "Secret of the team", pipeId: pipe })).body.id;
    await alice.post(`/api/tasks/${task}/comments`, { body: "Comment before leaving" });
    expect((await bob.del(`/api/spaces/${team}/members/${aliceId}`)).status).toBe(200);
    const data = JSON.parse((await download(alice.cookie)).files.get("data.json")!.toString());
    expect(JSON.stringify(data.tasks)).not.toContain("Secret of the team");
    expect(data.comments.find((c: { text: string }) => c.text === "Comment before leaving").task).toBeNull();
  });

  it("needs a session", async () => {
    expect((await download("")).res.statusCode).toBe(401);
  });
});

describe("account deletion", () => {
  it("is not offered to Outline accounts", async () => {
    const res = await alice.post("/api/me/delete/request");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("An Outline account cannot be deleted here: it comes from your Outline workspace.");
  });

  it("needs e-mail or two-factor authentication", async () => {
    const { g } = await guest("no-way@example.com", "No way");
    expect((await g.post("/api/me/delete/request")).body.error).toBe("Deleting an account needs e-mail or two-factor authentication on this instance.");
  });

  it("with two-factor authentication, takes a code and anonymises the history", async () => {
    const { g, id, space } = await guest("leaving@example.com", "Leaving Person");
    const { secret } = (await g.post("/api/me/totp/setup")).body;
    const step = Math.floor(Date.now() / 30_000);
    expect((await g.post("/api/me/totp/enable", { code: codeAt(secret, step) })).status).toBe(200);

    // A team they administer alone, with Bob in it, and a team of their own.
    const shared = (await g.post("/api/spaces", { name: "Shared team", members: [{ userId: bobId }] })).body.id;
    const sharedPipe = (await g.post(`/api/spaces/${shared}/pipes`, { name: "Board" })).body.id;
    const kept = (await g.post("/api/tasks", { title: "Stays in the team", pipeId: sharedPipe })).body.id;
    await g.post(`/api/tasks/${kept}/comments`, { body: "Said before leaving" });
    const alone = (await g.post("/api/spaces", { name: "Alone team", members: [] })).body.id;
    const own = (await g.get("/api/sidebar")).body.mine[0].id;
    const personal = (await g.post("/api/tasks", { title: "Personal task", pipeId: own })).body.id;
    const sent = (await bob.post("/api/tasks", { title: "Sent to them", spaceId: space })).body.id;

    expect((await g.post("/api/me/delete/request")).body).toEqual({ method: "totp" });
    expect((await g.post("/api/me/delete", { code: "000000" })).body.error).toBe("Wrong code");
    expect((await g.post("/api/me/delete", { code: codeAt(secret, step + 1) })).status).toBe(200);

    expect((await g.get("/api/me")).status).toBe(401);
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [id])).rows).toEqual([]);
    // In the team: the work stays, under "Deleted account"; Bob, the oldest other member, is now its admin.
    const t = (await bob.get(`/api/tasks/${kept}`)).body;
    expect(t.author.name).toBe("Deleted account");
    expect(t.events.find((e: { comment: string | null }) => e.comment === "Said before leaving").actor.name).toBe("Deleted account");
    expect((await bob.get(`/api/spaces/${shared}`)).body.myRole).toBe("admin");
    // Their personal space, its tasks (also the one Bob sent) and the team they were alone in are gone.
    for (const task of [personal, sent]) expect((await bob.get(`/api/tasks/${task}`)).status).toBe(404);
    expect((await pool.query(`SELECT 1 FROM spaces WHERE id = ANY($1)`, [[space, alone]])).rows).toEqual([]);
    // Nothing points to the account any more, and its address is free.
    expect((await pool.query(`SELECT 1 FROM users WHERE lower(email) = 'leaving@example.com'`)).rows).toEqual([]);
  });

  it("by e-mail, takes the link once, whatever the browser", async () => {
    const mails: { to: string; url: string; subject: string }[] = [];
    deletionMail.enabled = () => true;
    deletionMail.send = async (_lang, to, subject, _p, action) => (mails.push({ to, subject, url: action.url }), true);
    const { g, id } = await guest("by-link@example.com", "By Link");
    expect((await g.post("/api/me/delete/request")).body).toEqual({ method: "email" });
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: "by-link@example.com", subject: "Confirm the deletion of your TasksPipes account" });
    const token = new URL(mails[0].url).searchParams.get("token");
    expect(new URL(mails[0].url).pathname).toBe("/account/delete");

    // The token is stored hashed.
    expect((await pool.query(`SELECT 1 FROM login_tokens WHERE id = $1`, [token])).rows).toEqual([]);
    // A sign-in link token does not delete anything, and a wrong token gets a plain answer.
    expect((await agent().post("/api/auth/delete-account", { token: "nope" })).body.error).toBe("This link is invalid or has expired.");
    const res = await agent().post("/api/auth/delete-account", { token });
    expect(res.status).toBe(200);
    expect((await g.get("/api/me")).status).toBe(401);
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [id])).rows).toEqual([]);
    expect((await agent().post("/api/auth/delete-account", { token })).status).toBe(400);
  });
});
