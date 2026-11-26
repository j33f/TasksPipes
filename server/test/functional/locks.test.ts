import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";
import { overrideSetting } from "../../src/settings-store.js";

let app: FastifyInstance, alice: Agent, bob: Agent, carol: Agent, base: string, token: string;
let pipe: string;

const A = "alice-page-1", A2 = "alice-page-2", B = "bob-page-1";
const newTask = async (title: string) => (await alice.post("/api/tasks", { title, pipeId: pipe })).body.id as string;
const lock = (who: Agent, task: string, client: string) => who.put(`/api/tasks/${task}/lock`, { client });
const claim = (who: Agent, task: string, client: string) => who.post(`/api/tasks/${task}/lock/claim`, { client });
const answer = (who: Agent, task: string, client: string, accept: boolean) => who.post(`/api/tasks/${task}/lock/answer`, { client, accept });
/** Makes time pass for a task's lock: its page last seen, or its claim made, that many seconds ago. */
const age = (task: string, column: "seen_at" | "claimed_at", seconds: number) =>
  pool.query(`UPDATE task_locks SET ${column} = now() - make_interval(secs => $2) WHERE task_id = $1`, [task, seconds]);

const bearer = async (method: string, url: string, body?: unknown) => {
  const res = await app.inject({
    method: method as "GET", url,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
  return { status: res.statusCode, body: res.json() as any };
};

/** Opens a live connection and collects its messages. */
function connect(cookie: string) {
  const ws = new WebSocket(base, { headers: { cookie, origin: "http://tasks.test" } });
  const messages: any[] = [];
  ws.on("message", (m) => messages.push(JSON.parse(String(m))));
  const next = (match: (m: any) => boolean) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no such message")), 5000);
      const check = () => {
        const m = messages.find(match);
        if (m) {
          clearTimeout(timer);
          resolve(m);
        } else setTimeout(check, 20);
      };
      check();
    });
  return { ws, next, messages };
}

beforeAll(async () => {
  app = await startApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/api/events`;
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  const bobId = (await bob.get("/api/me")).body.user.id;
  const team = (await alice.post("/api/spaces", { name: "Locks", members: [{ userId: bobId }] })).body.id;
  pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Board", kind: "dev" })).body.id;
  token = (await alice.post("/api/me/tokens", { name: "agent", scope: "write", days: 30 })).body.token;
});
afterAll(async () => {
  overrideSetting("mcp.enabled", undefined);
  await stopApp();
});

/** Calls a tool of the MCP endpoint with an agent token. */
async function mcpTool(agentToken: string, name: string, args: object) {
  const res = await app.inject({
    method: "POST", url: "/mcp",
    headers: {
      authorization: `Bearer ${agentToken}`, "content-type": "application/json",
      accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18",
    },
    payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = String(res.headers["content-type"]).startsWith("text/event-stream")
    ? (res.body.split("\n").filter((l) => l.startsWith("data:")).at(-1) ?? "").slice(5)
    : res.body;
  return JSON.parse(text).result;
}

describe("editing locks", () => {
  it("go to the first page that opens the task; the others read it, and cannot change it", async () => {
    const task = await newTask("First come");
    const mine = await lock(alice, task, A);
    expect(mine.body).toMatchObject({ mine: true, holder: { name: "Alice Martin" }, claim: null });
    // Kept by saying so again.
    expect((await lock(alice, task, A)).body.mine).toBe(true);

    const theirs = await lock(bob, task, B);
    expect(theirs.body).toMatchObject({ mine: false, holder: { name: "Alice Martin" } });
    const refused = await bob.patch(`/api/tasks/${task}`, { title: "Mine now" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("Alice Martin is editing this task");
    expect((await bob.post(`/api/tasks/${task}/items`, { text: "Step" })).status).toBe(409);

    // The holder changes it; so does she from another tab of hers.
    expect((await alice.patch(`/api/tasks/${task}`, { title: "Still mine" })).status).toBe(200);
    expect((await lock(alice, task, A2)).body.mine).toBe(false);
    expect((await alice.patch(`/api/tasks/${task}`, { description: "From the other tab" })).status).toBe(200);
  });

  it("are not for those who cannot see or change the task", async () => {
    const task = await newTask("Team only");
    expect((await lock(carol, task, "carol-page-1")).status).toBe(404);
    expect((await alice.put(`/api/tasks/${task}/lock`, { client: "x" })).body.error).toBe("Invalid page");
  });

  it("are released on closing, and forgotten once the page stopped saying so", async () => {
    const task = await newTask("Released");
    await lock(alice, task, A);
    await alice.del(`/api/tasks/${task}/lock?client=${A}`);
    expect((await lock(bob, task, B)).body.mine).toBe(true);
    await age(task, "seen_at", 100);
    expect((await bob.get(`/api/tasks/${task}/lock`)).body.holder).toBeNull();
    expect((await bob.patch(`/api/tasks/${task}`, { title: "Free again" })).status).toBe(200);
  });

  it("can be claimed: the holder hands over, or refuses", async () => {
    const task = await newTask("Claimed");
    await lock(alice, task, A);
    const asked = await claim(bob, task, B);
    expect(asked.body).toMatchObject({ mine: false, claim: { by: { name: "Bob Durand" }, mine: true } });
    expect(asked.body.claim.secondsLeft).toBeGreaterThan(25);

    // The holder sees it, refuses.
    expect((await lock(alice, task, A)).body.claim).toMatchObject({ by: { name: "Bob Durand" }, mine: false });
    expect((await answer(alice, task, A, false)).body).toMatchObject({ mine: true, claim: null });
    expect((await lock(bob, task, B)).body).toMatchObject({ mine: false, claim: null });

    // Asked again, handed over.
    await claim(bob, task, B);
    expect((await answer(alice, task, A, true)).body).toMatchObject({ mine: false, holder: { name: "Bob Durand" } });
    expect((await lock(bob, task, B)).body.mine).toBe(true);
    expect((await alice.patch(`/api/tasks/${task}`, { title: "Too late" })).status).toBe(409);
    // Only the holder answers.
    expect((await answer(alice, task, A, true)).body.holder.name).toBe("Bob Durand");
  });

  it("go to the one who claimed after 30 s without an answer", async () => {
    const task = await newTask("Unanswered");
    await lock(alice, task, A);
    await claim(bob, task, B);
    // Within the delay, the holder keeps it.
    expect((await lock(bob, task, B)).body.mine).toBe(false);
    await age(task, "claimed_at", 31);
    // Its change goes through even before its page asks again.
    expect((await bob.patch(`/api/tasks/${task}`, { title: "Mine at last" })).status).toBe(200);
    expect((await lock(bob, task, B)).body).toMatchObject({ mine: true, claim: null });
    expect((await lock(alice, task, A)).body).toMatchObject({ mine: false, holder: { name: "Bob Durand" } });
  });

  it("go at once to the one waiting when the holder closes the task", async () => {
    const task = await newTask("Waiting");
    await lock(alice, task, A);
    await claim(bob, task, B);
    await alice.del(`/api/tasks/${task}/lock?client=${A}`);
    expect((await bob.get(`/api/tasks/${task}/lock?client=${B}`)).body.mine).toBe(true);
  });

  it("take one claim at a time; a claim is withdrawn on closing", async () => {
    const task = await newTask("One at a time");
    await lock(bob, task, B);
    await claim(alice, task, A);
    const second = await claim(alice, task, A2);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("Alice Martin already asked for it");
    await alice.del(`/api/tasks/${task}/lock?client=${A}`);
    expect((await lock(bob, task, B)).body).toMatchObject({ mine: true, claim: null });
  });

  it("do not stop an agent over MCP or the API, whose change reaches the holder's own pages", async () => {
    const task = await newTask("Agent at work");
    await lock(alice, task, A);
    await lock(bob, task, B);
    const page = connect(alice.cookie);
    await page.next((m) => m.type === "hello");
    expect((await bearer("PATCH", `/api/v1/tasks/${task}`, { title: "Done by the agent" })).status).toBe(200);
    const event = await page.next((m) => m.type === "task.updated" && m.taskId === task);
    expect(event).toMatchObject({ via: "token" });

    // Her AI agent, over MCP: told as such.
    overrideSetting("mcp.enabled", true);
    const agent = (await alice.post("/api/me/tokens", { name: "Claude", kind: "agent", scopes: ["tasks:write"], days: 30 })).body.token;
    const result = await mcpTool(agent, "update_task", { taskId: task, title: "Done by Claude" });
    expect(result.isError).toBeFalsy();
    expect(await page.next((m) => m.type === "task.updated" && m.taskId === task && m.via === "agent")).toMatchObject({ actorId: expect.any(String) });
    // Tokens do not lock.
    expect((await bearer("PUT", `/api/tasks/${task}/lock`, { client: "agent-page-1" })).status).toBe(401);
    expect((await bearer("PUT", `/api/v1/tasks/${task}/lock`, { client: "agent-page-1" })).status).toBeGreaterThanOrEqual(400);
    page.ws.close();
  });

  it("are told to the pages of the space", async () => {
    const task = await newTask("Told");
    const page = connect(bob.cookie);
    await page.next((m) => m.type === "hello");
    await lock(alice, task, A);
    expect(await page.next((m) => m.type === "lock" && m.task?.id === task)).toMatchObject({ change: "taken", by: "Alice Martin" });
    await claim(bob, task, B);
    await answer(alice, task, A, true);
    expect(await page.next((m) => m.type === "lock" && m.change === "granted")).toMatchObject({ task: { id: task } });
    page.ws.close();
  });
});
