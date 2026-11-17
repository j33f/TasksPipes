import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

let app: FastifyInstance, base: string;
let alice: Agent, bob: Agent, carol: Agent;
let ids: Record<string, string>, team: string, board: string;

type Item = { id: number; kind: string; actor: { name: string } | null; excerpt: string | null; task: { id: string; pipe: { id: string } | null } };
const inbox = async (who: Agent) => (await who.get("/api/inbox")).body as { items: Item[]; unread: number };
const kindsFor = async (who: Agent, task: string) => (await inbox(who)).items.filter((i) => i.task.id === task).map((i) => i.kind).sort();

beforeAll(async () => {
  app = await startApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/api/events`;
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  ids = {};
  for (const [n, a] of [["alice", alice], ["bob", bob], ["carol", carol]] as const) ids[n] = (await a.get("/api/me")).body.user.id;
  team = (await alice.post("/api/spaces", { name: "Inbox team", members: [{ userId: ids.bob }, { userId: ids.carol }] })).body.id;
  board = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Inbox board" })).body.id;
  // Start from an empty inbox.
  for (const a of [alice, bob, carol]) await a.post("/api/inbox/read", {});
});
afterAll(stopApp);

describe("in-app notifications", () => {
  it("tell the team of a task created by someone else, and its owner that it is theirs", async () => {
    const task = (await bob.post("/api/tasks", { title: "For Carol", pipeId: board, assigneeId: ids.carol })).body.id;
    expect(await kindsFor(alice, task)).toEqual(["created"]);
    expect(await kindsFor(carol, task)).toEqual(["assigned"]);
    expect(await kindsFor(bob, task)).toEqual([]);
    const item = (await inbox(alice)).items.find((i) => i.task.id === task)!;
    expect(item).toMatchObject({ actor: { name: "Bob Durand" }, task: { pipe: { id: board } } });
  });

  it("tell the author and the owner of a comment, with an excerpt", async () => {
    const task = (await bob.post("/api/tasks", { title: "Commented", pipeId: board, assigneeId: ids.carol })).body.id;
    await alice.post(`/api/tasks/${task}/comments`, { body: "Looks good" });
    expect(await kindsFor(bob, task)).toEqual(["comment"]);
    const carolItems = (await inbox(carol)).items.filter((i) => i.task.id === task);
    expect(carolItems.map((i) => i.kind).sort()).toEqual(["assigned", "comment"]);
    expect(carolItems.find((i) => i.kind === "comment")!.excerpt).toBe("Looks good");
    expect(await kindsFor(alice, task)).toEqual(["created"]);
  });

  it("are not written for one's own tasks in a personal pipe", async () => {
    const mine = (await alice.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
    const task = (await alice.post("/api/tasks", { title: "Just me", pipeId: mine })).body.id;
    expect(await kindsFor(alice, task)).toEqual([]);
  });

  it("are marked as read one by one or all at once, for oneself only", async () => {
    await bob.post("/api/tasks", { title: "One", pipeId: board });
    await bob.post("/api/tasks", { title: "Two", pipeId: board });
    const before = await inbox(alice);
    expect(before.unread).toBe(before.items.length);
    expect(before.unread).toBeGreaterThanOrEqual(2);
    const first = before.items[0].id;
    // Someone else cannot mark it.
    expect((await carol.post("/api/inbox/read", { ids: [first] })).status).toBe(200);
    expect((await inbox(alice)).unread).toBe(before.unread);
    const r = await alice.post("/api/inbox/read", { ids: [first] });
    expect(r.body.unread).toBe(before.unread - 1);
    expect((await inbox(alice)).items.map((i) => i.id)).not.toContain(first);
    expect((await alice.get("/api/inbox/count")).body.unread).toBe(before.unread - 1);
    expect((await alice.post("/api/inbox/read", {})).body.unread).toBe(0);
    expect((await inbox(alice)).items).toEqual([]);
    expect((await alice.post("/api/inbox/read", { ids: ["x"] })).status).toBe(400);
  });

  it("disappear for someone who can no longer see the task", async () => {
    await carol.post("/api/inbox/read", {});
    const task = (await bob.post("/api/tasks", { title: "Soon hidden", pipeId: board })).body.id;
    expect(await kindsFor(carol, task)).toEqual(["created"]);
    expect((await alice.del(`/api/spaces/${team}/members/${ids.carol}`)).status).toBe(200);
    expect(await kindsFor(carol, task)).toEqual([]);
    expect((await carol.get("/api/inbox/count")).body.unread).toBe(0);
    await alice.post(`/api/spaces/${team}/members`, { userId: ids.carol });
  });

  it("are told live to the person's open pages", async () => {
    const ws = new WebSocket(base, { headers: { cookie: alice.cookie, origin: "http://tasks.test" } });
    const types: string[] = [];
    ws.on("message", (m) => types.push(JSON.parse(String(m)).type));
    await new Promise((r) => ws.on("open", r));
    await new Promise((r) => setTimeout(r, 100));
    await bob.post("/api/tasks", { title: "Live", pipeId: board });
    await new Promise((r) => setTimeout(r, 300));
    ws.close();
    expect(types).toContain("inbox");
    expect(types).toContain("task.updated");
  });
});
