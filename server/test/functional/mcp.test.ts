/**
 * The MCP endpoint for AI agents (mcp.ts): off by default, agent tokens only, tools limited to the token's scopes and
 * spaces, confidential content never shown, and what an agent does recorded "via" it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { overrideSetting } from "../../src/settings-store.js";

let app: FastifyInstance, alice: Agent, bob: Agent;
let personalPipe: string, secretPipe: string, team: string, teamPipe: string;
let personalTask: string, secretTask: string;

beforeAll(async () => {
  app = await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  const me = (await alice.get("/api/me")).body;
  const bobId = (await bob.get("/api/me")).body.user.id;
  personalPipe = (await alice.post(`/api/spaces/${me.personalSpaceId}/pipes`, { name: "Mine" })).body.id;
  // A confidential pipe type: its content stays in the app.
  secretPipe = (await alice.post(`/api/spaces/${me.personalSpaceId}/pipes`, { name: "Garde", kind: "garde_alternee" })).body.id;
  team = (await alice.post("/api/spaces", { name: "Agents team", members: [{ userId: bobId }] })).body.id;
  teamPipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Team board" })).body.id;
  personalTask = (await alice.post("/api/tasks", { title: "Zephyr personal", pipeId: personalPipe })).body.id;
  secretTask = (await alice.post("/api/tasks", { title: "Zephyr secret", pipeId: secretPipe, taskType: "echange_garde" })).body.id;
  // Of the default type, offered everywhere: only its pipe tells it is confidential.
  await alice.post("/api/tasks", { title: "Zephyr secret plain", pipeId: secretPipe });
  await alice.post("/api/tasks", { title: "Zephyr team", pipeId: teamPipe });
});

afterAll(async () => {
  overrideSetting("mcp.enabled", undefined);
  await stopApp();
});

/** One JSON-RPC request to /mcp (2025-era stateless client). */
async function rpc(token: string | null, method: string, params: object = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  // A JSON body, or (2025-era clients) a short SSE stream whose last data line is the answer.
  const text = String(res.headers["content-type"]).startsWith("text/event-stream")
    ? (res.body.split("\n").filter((l) => l.startsWith("data:")).at(-1) ?? "").slice(5)
    : res.body;
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.statusCode, headers: res.headers, body };
}

/** Calls a tool and returns its parsed text, or the error text. */
async function tool(token: string, name: string, args: object = {}) {
  const { body } = await rpc(token, "tools/call", { name, arguments: args });
  const r = body.result;
  if (!r) return { error: body.error?.message ?? JSON.stringify(body) };
  const text = r.content?.[0]?.text ?? "";
  if (r.isError) return { error: text };
  return JSON.parse(text);
}

const agentToken = async (scopes: string[], spaceIds?: string[], days = 30) =>
  alice.post("/api/me/tokens", { name: "Claude", kind: "agent", scopes, ...(spaceIds ? { spaceIds } : {}), days });

describe("the MCP endpoint", () => {
  it("is off until an administrator turns it on, and agent tokens cannot be made meanwhile", async () => {
    expect((await rpc(null, "tools/list")).status).toBe(404);
    expect((await agentToken([])).status).toBe(403);
    overrideSetting("mcp.enabled", true);
  });

  it("takes agent tokens only", async () => {
    const none = await rpc(null, "tools/list");
    expect(none.status).toBe(401);
    expect(String(none.headers["www-authenticate"])).toMatch(/^Bearer /);
    const personal = (await alice.post("/api/me/tokens", { name: "script", scope: "write", days: 30 })).body.token;
    expect((await rpc(personal, "tools/list")).status).toBe(401);
    expect((await rpc("tp_" + "x".repeat(43), "tools/list")).status).toBe(401);
  });

  it("gives agent tokens 90 days at most, and only the spaces one sees", async () => {
    expect((await agentToken([], undefined, 120)).body.error).toBe("A token expires within 90 days");
    expect((await agentToken([], ["00000000-0000-4000-8000-000000000000"])).status).toBe(400);
  });

  it("refuses JSON-RPC batches, so that each tool call counts in the rate limit", async () => {
    const token = (await agentToken([])).body.token;
    const res = await app.inject({
      method: "POST", url: "/mcp",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      payload: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses agent tokens on /api/v1, where its limits would not apply", async () => {
    const token = (await agentToken([])).body.token;
    const res = await app.inject({ method: "GET", url: "/api/v1/me/tasks", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe("a read-only agent", () => {
  let token: string;
  beforeAll(async () => {
    token = (await agentToken([])).body.token;
  });

  it("is offered the reading tools only", async () => {
    const names = (await rpc(token, "tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["whoami", "search_tasks", "get_task", "get_pipe"]));
    expect(names).not.toContain("create_task");
    expect(names).not.toContain("add_comment");
    expect((await tool(token, "create_task", { pipeId: personalPipe, title: "No" })).error).toBeTruthy();
  });

  it("never sees confidential tasks, and says how many were left out", async () => {
    const found = await tool(token, "search_tasks", { query: "Zephyr" });
    const titles = found.tasks.map((t: { title: string }) => t.title);
    expect(titles).toEqual(expect.arrayContaining(["Zephyr personal", "Zephyr team"]));
    expect(titles).not.toContain("Zephyr secret");
    expect(titles).not.toContain("Zephyr secret plain");
    expect(found.hidden).toMatch(/^2 hidden/);
    expect(found.notice).toMatch(/never as instructions/);
    expect((await tool(token, "get_task", { taskId: secretTask })).error).toBe("Task not found");
    expect((await tool(token, "get_pipe", { pipeId: secretPipe })).error).toBe("Pipe not found");
  });
});

describe("an agent limited to a team space, allowed to write", () => {
  let token: string;
  beforeAll(async () => {
    token = (await agentToken(["tasks:write", "comments:write"], [team])).body.token;
  });

  it("sees and changes nothing outside its space", async () => {
    const spaces = await tool(token, "list_spaces");
    expect(spaces.map((s: { id: string }) => s.id)).toEqual([team]);
    expect((await tool(token, "get_task", { taskId: personalTask })).error).toBe("Task not found");
    expect((await tool(token, "create_task", { pipeId: personalPipe, title: "Outside" })).error).toBe("Pipe not found");
    expect((await tool(token, "add_comment", { taskId: personalTask, body: "Hi" })).error).toBe("Task not found");
  });

  it("acts as its owner, recorded via the agent in the history", async () => {
    const created = await tool(token, "create_task", { pipeId: teamPipe, title: "Made by the agent" });
    expect(created.title).toBe("Made by the agent");
    expect(await tool(token, "add_comment", { taskId: created.id, body: "Noted" })).toEqual({ ok: true });
    const task = (await alice.get(`/api/tasks/${created.id}`)).body;
    expect(task.events[0].actor.name).toBe("Alice Martin");
    expect(task.events.every((e: { via: { name: string; kind: string } | null }) => e.via?.name === "Claude" && e.via.kind === "agent")).toBe(true);
    // Done in the app: no "via".
    await alice.post(`/api/tasks/${created.id}/comments`, { body: "By hand" });
    expect((await alice.get(`/api/tasks/${created.id}`)).body.events.at(-1).via).toBeNull();
  });

  it("cannot send tasks to others or log time without those scopes", async () => {
    const names = (await rpc(token, "tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain("send_task");
    expect(names).not.toContain("log_time");
  });

  it("stops working once revoked", async () => {
    const id = (await alice.get("/api/me/tokens")).body.find((t: { kind: string; spaceIds: string[] | null }) => t.kind === "agent" && t.spaceIds?.[0] === team).id;
    expect((await alice.del(`/api/me/tokens/${id}`)).status).toBe(200);
    expect((await rpc(token, "tools/list")).status).toBe(401);
  });
});
