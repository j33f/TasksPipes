import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import { signIn, signInWithLink, startApp, stopApp, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";
import { notificationState, runNotifications } from "../../src/notifications.js";

let app: FastifyInstance, alice: Agent, bob: Agent, carol: Agent, base: string;
let ids: Record<string, string>, team: string, board: string, open: string;

const mention = (name: string) => `@[${name}](mention:${ids[name]})`;
const queued = async (task: string) =>
  (await pool.query(`SELECT u.name, n.kind FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.task_id = $1 ORDER BY u.name`, [task])).rows
    .map((r) => `${r.name}:${r.kind}`);
const names = async (a: Agent, task: string, q = "") => ((await a.get(`/api/tasks/${task}/mentionable?q=${q}`)).body as { name: string }[]).map((p) => p.name);

beforeAll(async () => {
  app = await startApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/api/events`;
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  ids = {};
  for (const [n, a] of [["Alice Martin", alice], ["Bob Durand", bob], ["Carol Petit", carol]] as const) ids[n] = (await a.get("/api/me")).body.user.id;
  team = (await alice.post("/api/spaces", { name: "Mentions", members: [{ userId: ids["Bob Durand"] }] })).body.id;
  board = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Private board" })).body.id;
  open = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Open board", visibility: "open" })).body.id;
  notificationState.enabled = true;
});
beforeEach(() => {
  notificationState.enabled = true;
});
afterAll(async () => {
  notificationState.enabled = false;
  await stopApp();
});

describe("who can be mentioned", () => {
  it("only people who can open the task, among those one sees", async () => {
    const task = (await alice.post("/api/tasks", { title: "Private", pipeId: board })).body.id;
    expect(await names(alice, task)).toEqual(["Bob Durand"]);
    // In an open pipe, Carol (who sees the team) can open the task too.
    const visible = (await alice.post("/api/tasks", { title: "Open", pipeId: open })).body.id;
    expect(await names(alice, visible)).toEqual(expect.arrayContaining(["Bob Durand", "Carol Petit"]));
    expect(await names(alice, visible, "car")).toEqual(["Carol Petit"]);
    // Not Dave, who never signed in, nor someone invited by Bob whom Alice does not see.
    const hidden = await signInWithLink((await bob.post("/api/invitations", { email: "mention-hidden@example.com", name: "Hidden" })).body.link);
    void hidden;
    expect(await names(alice, visible)).not.toContain("Dave Leroy");
    expect(await names(alice, visible)).not.toContain("Hidden");
    // Someone who cannot open the task learns nothing about it.
    expect((await carol.get(`/api/tasks/${task}/mentionable`)).status).toBe(404);
  });
});

describe("mentions", () => {
  it("in a comment notify the person mentioned, and only if they can open the task", async () => {
    const task = (await alice.post("/api/tasks", { title: "Mention me", pipeId: board })).body.id;
    await alice.post(`/api/tasks/${task}/comments`, { body: `${mention("Bob Durand")} ${mention("Carol Petit")} ${mention("Alice Martin")} look` });
    // Bob: a mention; Carol cannot open the private pipe; Alice wrote it.
    expect(await queued(task)).toEqual(["Bob Durand:mention"]);
  });

  it("in a description notify those newly mentioned", async () => {
    const task = (await alice.post("/api/tasks", { title: "Described", pipeId: open, description: `For ${mention("Bob Durand")}` })).body.id;
    expect(await queued(task)).toEqual(["Bob Durand:mention"]);
    await alice.patch(`/api/tasks/${task}`, { description: `For ${mention("Bob Durand")} and ${mention("Carol Petit")}` });
    expect(await queued(task)).toEqual(["Bob Durand:mention", "Carol Petit:mention"]);
    await alice.patch(`/api/tasks/${task}`, { description: `For ${mention("Bob Durand")} and ${mention("Carol Petit")}, edited` });
    expect(await queued(task)).toHaveLength(2);
  });

  it("are shown live, and e-mailed only to people not online", async () => {
    const ws = new WebSocket(base, { headers: { cookie: bob.cookie, origin: "http://tasks.test" } });
    const messages: any[] = [];
    ws.on("message", (m) => messages.push(JSON.parse(String(m))));
    await new Promise((r) => ws.on("open", r));
    const task = (await alice.post("/api/tasks", { title: "Live mention", pipeId: open })).body.id;
    await alice.post(`/api/tasks/${task}/comments`, { body: `${mention("Bob Durand")} ${mention("Carol Petit")}` });
    await new Promise((r) => setTimeout(r, 100));
    expect(messages.find((m) => m.type === "mention")).toMatchObject({ task: { id: task, title: "Live mention" }, by: "Alice Martin" });

    const sent: string[] = [];
    await runNotifications(new Date(Date.now() + 3 * 60_000), async (m) => void sent.push(m.to));
    // Bob is online: no e-mail; Carol is not: she gets one.
    expect(sent).toContain("carol@example.com");
    expect(sent).not.toContain("bob@example.com");
    const { rows } = await pool.query(`SELECT channel FROM notifications WHERE task_id = $1 AND user_id = $2`, [task, ids["Bob Durand"]]);
    expect(rows[0].channel).toBe("online");
    ws.close();
  });
});
