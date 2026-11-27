/**
 * The agent's event stream (GET /mcp/events) and the TasksPipes channel for Claude Code (web/public/
 * taskspipes-channel.mjs), end to end: the channel runs as Claude Code runs it (a subprocess speaking MCP on stdio)
 * against this app listening on a port; what people do on the tasks handed to the agent arrives as channel
 * notifications, and the channel's reply tool comments as the agent.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { overrideSetting } from "../../src/settings-store.js";
import { agentEvents, lastEventId } from "../../src/agent-events.js";

let app: FastifyInstance, alice: Agent, bob: Agent, aliceId: string, base = "";
let token = "", teamPipe = "", secretPipe = "", personalSpace = "";
let channel: ChildProcessWithoutNullStreams;
const received: any[] = [];

beforeAll(async () => {
  process.env.AGENT_EVENTS_POLL_MS = "150";
  app = await startApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  overrideSetting("mcp.enabled", true);
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  const me = (await alice.get("/api/me")).body;
  aliceId = me.user.id;
  personalSpace = me.personalSpaceId;
  const bobId = (await bob.get("/api/me")).body.user.id;
  const team = (await alice.post("/api/spaces", { name: "Channel team", members: [{ userId: bobId }] })).body.id;
  teamPipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Channel board" })).body.id;
  secretPipe = (await alice.post(`/api/spaces/${personalSpace}/pipes`, { name: "Garde", kind: "garde_alternee" })).body.id;
  token = (await alice.post("/api/me/tokens", { name: "Claude", kind: "agent", scopes: ["comments:write", "tasks:write"], days: 30 })).body.token;
});

afterAll(async () => {
  channel?.kill();
  overrideSetting("mcp.enabled", undefined);
  delete process.env.AGENT_EVENTS_POLL_MS;
  await stopApp();
});

/** One message to the channel, as Claude Code sends it. */
const toChannel = (msg: object) => channel.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");

async function until<T>(find: () => T | undefined, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = find();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`Timed out; received: ${JSON.stringify(received)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("the agent's event stream", () => {
  it("needs a valid agent token", async () => {
    expect((await fetch(`${base}/mcp/events`)).status).toBe(401);
    expect((await fetch(`${base}/mcp/events`, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("tells a task handed to the agent and comments by people, never confidential ones nor the agent's own", async () => {
    const from = await lastEventId();
    const task = (await alice.post("/api/tasks", { title: "Write the release notes", pipeId: teamPipe, assigneeId: aliceId })).body.id;
    await alice.patch(`/api/tasks/${task}`, { assigneeAgent: true });
    await bob.post(`/api/tasks/${task}/comments`, { body: "Mention the AI assistant." });
    const other = (await alice.post("/api/tasks", { title: "Not the agent's", pipeId: teamPipe })).body.id;
    await bob.post(`/api/tasks/${other}/comments`, { body: "Unrelated." });
    const secret = (await alice.post("/api/tasks", { title: "Secret", pipeId: secretPipe })).body.id;
    await alice.patch(`/api/tasks/${secret}`, { assigneeAgent: true });
    await alice.post(`/api/tasks/${secret}/comments`, { body: "Hidden." });
    const { events, cursor } = await agentEvents(aliceId, null, from);
    expect(events.map((e) => [e.type, e.task.title, e.comment ?? null])).toEqual([
      ["assigned", "Write the release notes", null],
      ["comment", "Write the release notes", "Mention the AI assistant."],
    ]);
    expect(Number(cursor)).toBeGreaterThan(Number(events.at(-1)!.id));
    // Out of the token's spaces: nothing.
    expect((await agentEvents(aliceId, new Set([personalSpace]), from)).events).toEqual([]);
  });
});

describe("the TasksPipes channel for Claude Code", () => {
  it("declares itself a channel and relays events, and its reply tool comments as the agent", async () => {
    channel = spawn(process.execPath, [join(__dirname, "../../../web/public/taskspipes-channel.mjs")], {
      env: { ...process.env, TASKSPIPES_URL: base, TASKSPIPES_TOKEN: token },
    });
    let out = "";
    channel.stderr.on("data", (c) => received.push({ stderr: String(c) }));
    channel.stdout.on("data", (c) => {
      out += c;
      let nl;
      while ((nl = out.indexOf("\n")) >= 0) {
        received.push(JSON.parse(out.slice(0, nl)));
        out = out.slice(nl + 1);
      }
    });
    toChannel({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    const init = await until(() => received.find((m) => m.id === 1));
    expect(init.result.capabilities.experimental).toEqual({ "claude/channel": {} });
    toChannel({ method: "notifications/initialized" });
    toChannel({ id: 2, method: "tools/list" });
    expect((await until(() => received.find((m) => m.id === 2))).result.tools.map((t: { name: string }) => t.name)).toEqual(["reply", "move"]);
    // The stream starts now: wait until it is open (its first poll) before acting.
    await new Promise((r) => setTimeout(r, 600));

    const task = (await alice.post("/api/tasks", { title: "Fix the login page", pipeId: teamPipe, assigneeId: aliceId })).body.id;
    await alice.patch(`/api/tasks/${task}`, { assigneeAgent: true });
    await bob.post(`/api/tasks/${task}/comments`, { body: "It fails on Safari." });
    const isFor = (event: string) => (m: any) => m.method === "notifications/claude/channel" && m.params.meta.task_id === task && m.params.meta.event === event;
    const assigned = await until(() => received.find(isFor("assigned")));
    expect(assigned.params.content).toContain("Fix the login page");
    const comment = await until(() => received.find(isFor("comment")));
    expect(comment.params.content).toContain("It fails on Safari.");
    expect(comment.params.meta).toMatchObject({ by: "Bob Durand", task_number: expect.stringMatching(/^\d+$/) });

    toChannel({ id: 3, method: "tools/call", params: { name: "reply", arguments: { task_id: task, text: "Looking into it." } } });
    const replied = await until(() => received.find((m) => m.id === 3));
    expect(replied.result).toEqual({ content: [{ type: "text", text: "Comment added." }] });
    const events = (await alice.get(`/api/tasks/${task}`)).body.events;
    expect(events.find((e: { comment?: string }) => e.comment === "Looking into it.")).toMatchObject({ via: { kind: "agent" } });
    // Its own comment does not come back to it.
    await new Promise((r) => setTimeout(r, 600));
    expect(received.filter(isFor("comment"))).toHaveLength(1);
  });
});
