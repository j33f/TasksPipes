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

  it("lets an agent token never expire", async () => {
    const created = (await alice.post("/api/me/tokens", { name: "Forever agent", kind: "agent", scopes: [], days: null })).body;
    expect(created.expiresAt).toBeNull();
    expect((await rpc(created.token, "tools/list")).status).toBe(200);
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

  it("can learn how TasksPipes works from the documentation of this version", async () => {
    const contents = await tool(token, "docs_contents");
    const features = contents.find((d: { doc: string }) => d.doc === "features");
    expect(features.sections).toEqual(expect.arrayContaining(["Incoming buckets", "Tasks"]));
    const exact = await tool(token, "read_docs", { topic: "incoming buckets" });
    expect(exact).toHaveLength(1);
    expect(exact[0]).toMatchObject({ doc: "features", section: "Incoming buckets" });
    expect(exact[0].text).toMatch(/^## Incoming buckets/);
    const searched = await tool(token, "read_docs", { topic: "recurring tasks every month" });
    expect(searched.length).toBeGreaterThan(0);
    expect(searched[0]).toMatchObject({ doc: "features", section: "Tasks" });
    expect(searched[0].text).toMatch(/recurring tasks/);
    expect((await tool(token, "read_docs", { topic: "zzqqxx" })).error).toMatch(/Nothing in the documentation/);
  });

  it("is told what TasksPipes is when it connects", async () => {
    const init = await rpc(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body.result.instructions).toMatch(/incoming bucket/);
    expect(init.body.result.instructions).toMatch(/docs_contents/);
  });

  it("is offered every tool, but may only read: the others say which permission they need", async () => {
    const names = (await rpc(token, "tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["whoami", "search_tasks", "get_task", "get_pipe", "create_task", "add_comment", "delete_model"]));
    const refused = await tool(token, "create_task", { pipeId: personalPipe, title: "No" });
    expect(refused.error).toMatch(/not given you the permission "Create and change tasks".*Settings › AI agents \(MCP\)/);
    expect(refused.error).toMatch(/Never say it was done/);
    expect((await tool(token, "whoami")).missingPermissions).toEqual(expect.arrayContaining(["Create and change tasks", "Comment"]));
  });

  it("sees every column of a pipe, which tells where each task stands", async () => {
    const pipe = await tool(token, "get_pipe", { pipeId: personalPipe });
    expect(pipe.columns.map((x: { id: string; status: string }) => [x.id, x.status])).toEqual([
      ["backlog", "backlog"], ["ready", "ready"], ["ongoing", "ongoing"], ["blocked", "blocked"], ["done", "done"], ["abandoned", "abandoned"],
    ]);
    expect(pipe.taskTypes.map((x: { id: string }) => x.id)).toEqual(["task"]);
    const task = pipe.tasks.find((t: { id: string }) => t.id === personalTask);
    expect(pipe.columns.map((x: { id: string }) => x.id)).toContain(task.stage);
    expect(task).toMatchObject({ estimateMinutes: null, loggedMinutes: 0 });
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

  it("reads a pipe's sprints and velocity, and plans a task in a sprint", async () => {
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Agent sprints", kind: "sprint" })).body.id;
    await alice.patch(`/api/pipes/${pipe}`, { sprintSettings: { velocityMode: "manual", initialVelocity: 13 } });
    const sprint = (await alice.post(`/api/pipes/${pipe}/sprints`, { goal: "Ship" })).body;
    const task = (await alice.post("/api/tasks", { title: "Plan me", pipeId: pipe, points: 5 })).body.id;
    const read = await tool(token, "get_sprints", { pipeId: pipe });
    expect(read).toMatchObject({
      sprints: [{ id: sprint.id, name: "Sprint 1", goal: "Ship", status: "planned" }],
      velocity: { pointsPerSprint: 13, source: "manual" }, remainingPoints: 5, projection: { sprintsLeft: 1 },
    });
    expect(await tool(token, "update_task", { taskId: task, sprintId: sprint.id })).toMatchObject({ sprintId: sprint.id, points: 5 });
    expect((await tool(token, "get_sprints", { pipeId: teamPipe })).sprints).toEqual([]);
  });

  it("reads a pipe's columns and task types, and fills a task's fields", async () => {
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Agent dev", kind: "dev" })).body.id;
    const read = await tool(token, "get_pipe", { pipeId: pipe });
    expect(read.columns.map((x: { id: string }) => x.id)).toEqual(["backlog", "a_faire", "en_cours", "revue", "bloque", "termine", "abandonne"]);
    expect(read.columns[2]).toMatchObject({ id: "en_cours", status: "started", label: expect.any(String) });
    expect(read.taskTypes.map((x: { id: string }) => x.id)).toEqual(["task", "user_story", "bug", "tache_technique", "release"]);
    const bug = read.taskTypes.find((x: { id: string }) => x.id === "bug");
    expect(bug.fields.find((f: { id: string }) => f.id === "severite")).toMatchObject({ type: "select", options: ["Bloquant", "Critique", "Majeur", "Mineur"] });
    expect(bug.fields.find((f: { id: string }) => f.id === "captures")).toMatchObject({ type: "files", readOnly: true });

    const created = await tool(token, "create_task", {
      pipeId: pipe, title: "Crash", stage: "en_cours", taskType: "bug", estimateMinutes: 90, fields: { severite: "Majeur", version: "0.31.0" },
    });
    expect(created).toMatchObject({ stage: "en_cours", status: "started", type: "bug", estimateMinutes: 90 });
    const task = await tool(token, "get_task", { taskId: created.id });
    expect(task.column).toMatchObject({ id: "en_cours", label: expect.any(String) });
    expect(task.fields).toEqual([
      expect.objectContaining({ id: "severite", type: "select", value: "Majeur" }),
      expect.objectContaining({ id: "version", type: "text", value: "0.31.0" }),
    ]);

    await tool(token, "update_task", { taskId: created.id, fields: { severite: "Critique", version: null } });
    expect((await tool(token, "get_task", { taskId: created.id })).fields).toEqual([expect.objectContaining({ id: "severite", value: "Critique" })]);
    expect((await tool(token, "update_task", { taskId: created.id, fields: { severite: "Énorme" } })).error).toMatch(/invalid choice/i);
    expect((await tool(token, "update_task", { taskId: created.id, fields: { captures: [] } })).error).toMatch(/uploaded separately/);
    // Only the types the pipe offers, never a confidential one.
    expect((await tool(token, "create_task", { pipeId: pipe, title: "No", taskType: "echange_garde" })).error).toMatch(/does not offer/);
    expect((await tool(token, "update_task", { taskId: created.id, taskType: "opportunite" })).error).toMatch(/does not offer/);
    expect(await tool(token, "update_task", { taskId: created.id, taskType: "user_story" })).toMatchObject({ type: "user_story" });
  });

  it("names the people in a task's fields, as its owner sees them", async () => {
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Agent chores", kind: "menage_coloc" })).body.id;
    const bobId = (await bob.get("/api/me")).body.user.id;
    const created = await tool(token, "create_task", { pipeId: pipe, title: "Dishes", taskType: "corvee", fields: { qui: bobId } });
    const qui = (await tool(token, "get_task", { taskId: created.id })).fields.find((f: { id: string }) => f.id === "qui");
    expect(qui).toMatchObject({ type: "user", value: { id: bobId, name: "Bob Durand" } });
    // Someone its owner cannot see keeps only their id.
    const stranger = "00000000-0000-4000-8000-000000000001";
    await tool(token, "update_task", { taskId: created.id, fields: { qui: stranger } });
    const unknown = (await tool(token, "get_task", { taskId: created.id })).fields.find((f: { id: string }) => f.id === "qui");
    expect(unknown.value).toEqual({ id: stranger, name: null });
  });

  it("cannot send tasks to others or log time without those scopes", async () => {
    expect((await tool(token, "log_time", { taskId: "00000000-0000-4000-8000-000000000001", minutes: 5 })).error).toMatch(/"Log my time"/);
    expect((await tool(token, "send_task", { taskId: "00000000-0000-4000-8000-000000000001", spaceId: team })).error).toMatch(/"Send tasks to other people"/);
  });

  it("stops working once revoked", async () => {
    const id = (await alice.get("/api/me/tokens")).body.find((t: { kind: string; spaceIds: string[] | null }) => t.kind === "agent" && t.spaceIds?.[0] === team).id;
    expect((await alice.del(`/api/me/tokens/${id}`)).status).toBe(200);
    expect((await rpc(token, "tools/list")).status).toBe(401);
  });
});

describe("an agent with full access to tasks", () => {
  let token: string, bobId: string, aliceId: string, pipe: string;
  beforeAll(async () => {
    token = (await agentToken(["tasks:write", "comments:write", "time:write", "tasks:delete"])).body.token;
    bobId = (await bob.get("/api/me")).body.user.id;
    aliceId = (await alice.get("/api/me")).body.user.id;
    pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Full access" })).body.id;
  });

  it("changes everything a person can: owner, labels, sub-tasks, dependencies, time", async () => {
    const label = (await alice.post(`/api/spaces/${team}/labels`, { name: "Urgent", color: "#ed2651" })).body.id;
    const space = await tool(token, "get_space", { spaceId: team });
    expect(space.members.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining([aliceId, bobId]));
    expect(space.labels).toEqual(expect.arrayContaining([{ id: label, name: "Urgent" }]));

    const created = await tool(token, "create_task", {
      pipeId: pipe, title: "Ship it", assigneeId: bobId, labelIds: [label], subtasks: ["Build", "Test"],
    });
    let task = await tool(token, "get_task", { taskId: created.id });
    expect(task.owner).toEqual({ id: bobId, name: "Bob Durand" });
    expect(task.labels).toEqual([{ id: label, name: "Urgent" }]);
    expect(task.subtasks.map((s: { text: string; done: boolean }) => [s.text, s.done])).toEqual([["Build", false], ["Test", false]]);
    expect(task.author).toEqual({ name: "Alice Martin", viaAgent: "Claude" });

    const [build, test] = task.subtasks.map((s: { id: string }) => s.id);
    expect(await tool(token, "update_subtask", { taskId: created.id, subtaskId: build, done: true })).toEqual({ ok: true });
    expect((await tool(token, "add_subtasks", { taskId: created.id, texts: ["Release"] })).added).toHaveLength(1);
    await tool(token, "update_subtask", { taskId: created.id, subtaskId: test, text: "Test it", position: 0 });
    task = await tool(token, "get_task", { taskId: created.id });
    expect(task.subtasks.map((s: { text: string }) => s.text)).toEqual(["Test it", "Build", "Release"]);
    expect(task.subtasks[1]).toMatchObject({ done: true, doneBy: "Alice Martin" });
    // A sub-task of another task is not this one's.
    expect((await tool(token, "update_subtask", { taskId: personalTask, subtaskId: build, done: false })).error).toBe("Sub-task not found");

    const other = await tool(token, "create_task", { pipeId: pipe, title: "First this" });
    expect((await tool(token, "add_dependency", { taskId: created.id, waitsForTaskId: other.id })).waitsFor).toEqual([
      { id: other.id, number: other.number, status: "backlog", done: false },
    ]);
    expect((await tool(token, "remove_dependency", { taskId: created.id, waitsForTaskId: other.id })).waitsFor).toEqual([]);

    await tool(token, "update_task", { taskId: created.id, assigneeId: null, labelIds: [] });
    task = await tool(token, "get_task", { taskId: created.id });
    expect(task).toMatchObject({ owner: null, labels: [] });

    await tool(token, "log_time", { taskId: created.id, minutes: 30 });
    const logged = await tool(token, "list_time_entries", { taskId: created.id });
    expect(logged).toMatchObject({ totalMinutes: 30, entries: [{ minutes: 30, yours: true }] });
    const changed = await tool(token, "update_time_entry", { taskId: created.id, entryId: logged.entries[0].id, minutes: 45 });
    expect(changed.totalMinutes).toBe(45);

    // Deleting, as the person could.
    expect(await tool(token, "delete_subtask", { taskId: created.id, subtaskId: build })).toEqual({ ok: true });
    expect(await tool(token, "delete_time_entry", { taskId: created.id, entryId: logged.entries[0].id })).toEqual({ ok: true });
    task = await tool(token, "get_task", { taskId: created.id });
    expect(task.subtasks).toHaveLength(2);
    expect(task.loggedMinutes).toBe(0);
  });

  it("deletes nothing without the Delete permission", async () => {
    const writer = (await agentToken(["tasks:write"])).body.token;
    const t = await tool(writer, "create_task", { pipeId: pipe, title: "Kept" });
    const [sub] = (await tool(writer, "add_subtasks", { taskId: t.id, texts: ["Step"] })).added;
    expect((await tool(writer, "delete_subtask", { taskId: t.id, subtaskId: sub })).error).toMatch(/"Delete"/);
    expect((await tool(writer, "get_task", { taskId: t.id })).subtasks).toHaveLength(1);
  });

  it("marks what it does as done over MCP", async () => {
    const created = await tool(token, "create_task", { pipeId: pipe, title: "By the agent" });
    const seen = (await alice.get(`/api/tasks/${created.id}`)).body;
    expect(seen.createdVia).toEqual({ name: "Claude", kind: "agent" });
    expect(seen.events[0].via).toEqual({ name: "Claude", kind: "agent" });
    const byHand = (await alice.post("/api/tasks", { title: "By hand", pipeId: pipe })).body.id;
    expect((await alice.get(`/api/tasks/${byHand}`)).body.createdVia).toBeNull();
  });
});

describe("tasks handed to one's AI agent", () => {
  let token: string, aliceId: string, bobId: string, pipe: string;
  beforeAll(async () => {
    token = (await agentToken(["tasks:write"])).body.token;
    aliceId = (await alice.get("/api/me")).body.user.id;
    bobId = (await bob.get("/api/me")).body.user.id;
    pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Handed" })).body.id;
  });

  it("can be handed by its owner only, with an agent of theirs", async () => {
    expect((await alice.get("/api/me")).body.hasAgent).toBe(true);
    expect((await bob.get("/api/me")).body.hasAgent).toBe(false);
    const task = (await alice.post("/api/tasks", { title: "For my agent", pipeId: pipe, assigneeId: aliceId })).body.id;
    // Someone else cannot hand it to Alice's agent; Bob has no agent to hand his own tasks to.
    expect((await bob.patch(`/api/tasks/${task}`, { assigneeAgent: true })).body.error).toBe("Only its owner can hand a task to their AI agent");
    const bobs = (await bob.post("/api/tasks", { title: "Bob's", pipeId: pipe, assigneeId: bobId })).body.id;
    expect((await bob.patch(`/api/tasks/${bobs}`, { assigneeAgent: true })).body.error).toBe("Make an AI agent first (Settings › AI agents)");

    expect((await alice.patch(`/api/tasks/${task}`, { assigneeAgent: true })).status).toBe(200);
    const handed = (await alice.get(`/api/tasks/${task}`)).body;
    expect(handed.assignee).toMatchObject({ id: aliceId, agent: true });
    expect(handed.events.at(-1)).toMatchObject({ from: { assignee: { id: aliceId } }, to: { assignee: { id: aliceId, agent: true } } });
    expect(handed.events.at(-1).from.assignee.agent).toBeUndefined();

    // The agent finds it among the tasks assigned to it.
    const mine = await tool(token, "agent_tasks");
    expect(mine.tasks.map((t: { id: string }) => t.id)).toEqual([task]);
    expect(mine.tasks[0]).toMatchObject({ assignedToAgent: true, assignedToYou: true });

    // Given to someone else, it is no longer the agent's.
    await alice.patch(`/api/tasks/${task}`, { assigneeId: bobId });
    expect((await alice.get(`/api/tasks/${task}`)).body.assignee).toMatchObject({ id: bobId, agent: false });
    expect((await tool(token, "agent_tasks")).tasks).toEqual([]);
  });

  it("can be handed by the agent itself, for its person's own tasks", async () => {
    const created = await tool(token, "create_task", { pipeId: pipe, title: "I take it", assigneeId: aliceId, assignToAgent: true });
    expect(created).toMatchObject({ assignedToYou: true });
    const back = await tool(token, "update_task", { taskId: created.id, assignToAgent: false });
    expect(back).toMatchObject({ assignedToAgent: false, assignee: "Alice Martin" });
    // In a personal space, the task is its holder's: the agent can take it too.
    const personal = await tool(token, "update_task", { taskId: personalTask, assignToAgent: true });
    expect(personal).toMatchObject({ assignedToYou: true });
    // As the web sends it: its holder named as the owner, with or without the agent.
    expect((await alice.patch(`/api/tasks/${personalTask}`, { assigneeId: aliceId, assigneeAgent: false })).status).toBe(200);
    expect((await alice.get(`/api/tasks/${personalTask}`)).body.assignee).toMatchObject({ id: aliceId, agent: false });
    expect((await alice.patch(`/api/tasks/${personalTask}`, { assigneeId: aliceId, assigneeAgent: true })).status).toBe(200);
    expect((await alice.get(`/api/tasks/${personalTask}`)).body.assignee).toMatchObject({ id: aliceId, agent: true });
    const fresh = (await alice.post("/api/tasks", { title: "Mine, for the agent", pipeId: personalPipe, assigneeId: aliceId, assigneeAgent: true })).body.id;
    expect((await alice.get(`/api/tasks/${fresh}`)).body.assignee).toMatchObject({ id: aliceId, agent: true });
    // Someone else still cannot own it.
    expect((await alice.patch(`/api/tasks/${personalTask}`, { assigneeId: bobId })).body.error).toBe(
      "A task in a personal space belongs to its holder: send it to someone instead."
    );
    expect((await tool(token, "update_task", { taskId: created.id, assigneeId: bobId, assignToAgent: true })).error).toBe(
      "Only its owner can hand a task to their AI agent"
    );
  });
});

describe("models over MCP", () => {
  let reader: string, maker: string, deleter: string;
  beforeAll(async () => {
    reader = (await agentToken([])).body.token;
    maker = (await agentToken(["models:write"])).body.token;
    deleter = (await agentToken(["models:write", "tasks:delete"])).body.token;
  });

  it("are read by any agent, never a confidential one", async () => {
    const names = (await rpc(reader, "tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_models", "get_model"]));
    expect((await tool(reader, "create_pipe_type", { label: "No", columns: [{ label: "To do", status: "backlog" }, { label: "Done", status: "done" }] })).error).toMatch(/"Create and change my models"/);
    const models = await tool(reader, "list_models");
    expect(models.pipeTypes.map((t: { id: string }) => t.id)).toContain("general");
    expect(models.pipeTypes.map((t: { id: string }) => t.id)).not.toContain("garde_alternee");
    expect(models.taskTypes.map((t: { id: string }) => t.id)).not.toContain("echange_garde");
    const general = await tool(reader, "get_model", { kind: "pipe", id: "general" });
    expect(general).toMatchObject({ kind: "pipe", id: "general", custom: false, yours: false });
    expect(general.columns.some((c: { status: string }) => c.status === "done")).toBe(true);
    expect((await tool(reader, "get_model", { kind: "pipe", id: "garde_alternee" })).error).toMatch(/not found/);
  });

  it("are made and changed by an agent allowed to, as its person", async () => {
    const names = (await rpc(maker, "tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["create_pipe_type", "update_pipe_type", "create_task_type", "update_task_type"]));
    expect((await tool(maker, "delete_model", { kind: "task", id: "x" })).error).toMatch(/"Delete"/);

    const lead = await tool(maker, "create_task_type", { label: "Prospect", fields: [{ label: "Budget", type: "money" }, { label: "Source", type: "select", options: ["Web", "Fair"] }] });
    expect(lead).toMatchObject({ kind: "task", label: "Prospect", custom: true, yours: true, visibility: "private" });
    expect(lead.fields.map((f: { type: string }) => f.type)).toEqual(["money", "select"]);
    const pipe = await tool(maker, "create_pipe_type", {
      label: "Prospects", taskTypes: [lead.id], templates: ["Call the first lead"],
      columns: [{ label: "To call", status: "backlog" }, { label: "Calling", status: "started" }, { label: "Signed", status: "done" }],
    });
    expect(pipe).toMatchObject({ kind: "pipe", label: "Prospects", yours: true, templates: ["Call the first lead"] });
    expect(pipe.taskTypes.map((t: { id: string }) => t.id)).toEqual(["task", lead.id]);

    // Only what is given changes; columns keep their ids.
    const kept = pipe.columns.slice(0, 2).concat([{ ...pipe.columns[2], label: "Won" }]);
    const changed = await tool(maker, "update_pipe_type", { id: pipe.id, label: "Sales prospects", columns: kept });
    expect(changed).toMatchObject({ label: "Sales prospects", templates: ["Call the first lead"] });
    expect(changed.columns.map((c: { id: string }) => c.id)).toEqual(pipe.columns.map((c: { id: string }) => c.id));
    expect(changed.columns[2].label).toBe("Won");
    const typed = await tool(maker, "update_task_type", { id: lead.id, description: "Someone who may buy" });
    expect(typed).toMatchObject({ description: "Someone who may buy" });
    expect(typed.fields).toHaveLength(2);
    // The person can use it at once.
    const space = (await alice.get("/api/me")).body.personalSpaceId;
    expect((await alice.post(`/api/spaces/${space}/pipes`, { name: "Prospecting", kind: pipe.id })).status).toBe(200);

    // Built-in models, others' models and confidential task types stay as they are.
    expect((await tool(maker, "update_pipe_type", { id: "general", label: "Mine" })).error).toMatch(/built-in types can be duplicated/);
    const bobs = (await bob.post("/api/catalog/task-types", { label: "Bob's", visibility: "public" })).body.id;
    expect((await tool(maker, "update_task_type", { id: bobs, label: "Taken" })).error).toMatch(/Only the author/);
    expect((await tool(maker, "create_pipe_type", {
      label: "Sneaky", taskTypes: ["echange_garde"], columns: [{ label: "A", status: "backlog" }, { label: "B", status: "done" }],
    })).error).toMatch(/not found/);

    // Recorded as the person's.
    expect((await alice.get("/api/catalog")).body.pipeTypes.find((t: { id: string }) => t.id === pipe.id).createdBy.name).toBe("Alice Martin");
  });

  it("are deleted only with the Delete permission too, once unused", async () => {
    const names = (await rpc(deleter, "tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("delete_model");
    const t = await tool(deleter, "create_task_type", { label: "Short-lived", fields: [] });
    expect(await tool(deleter, "delete_model", { kind: "task", id: t.id })).toEqual({ ok: true });
    expect((await tool(deleter, "get_model", { kind: "task", id: t.id })).error).toMatch(/not found/);
    const used = (await tool(deleter, "list_models")).pipeTypes.find((p: { label: string }) => p.label === "Sales prospects");
    expect((await tool(deleter, "delete_model", { kind: "pipe", id: used.id })).error).toMatch(/use this type/);
  });
});

describe("an agent's permissions changed on the fly", () => {
  it("apply at its next call, without connecting it again; only to one's own agents", async () => {
    const created = (await agentToken([])).body;
    const pipeId = personalPipe;
    expect((await tool(created.token, "create_task", { pipeId, title: "Later" })).error).toMatch(/"Create and change tasks"/);

    expect((await alice.patch(`/api/me/tokens/${created.id}`, { scopes: ["tasks:write", "pipes:write"] })).body).toMatchObject({ ok: true, scopes: ["tasks:read", "tasks:write", "pipes:write"], spaceIds: null });
    expect((await tool(created.token, "create_task", { pipeId, title: "Now" })).title).toBe("Now");
    expect((await tool(created.token, "whoami")).scopes).toEqual(["tasks:read", "tasks:write", "pipes:write"]);
    const listed = (await alice.get("/api/me/tokens")).body.find((t: { id: string }) => t.id === created.id);
    expect(listed).toMatchObject({ scope: "write", scopes: ["tasks:read", "tasks:write", "pipes:write"] });

    // Narrowed: to reading, and to one space.
    expect((await alice.patch(`/api/me/tokens/${created.id}`, { scopes: [], spaceIds: [team] })).status).toBe(200);
    expect((await tool(created.token, "create_task", { pipeId, title: "No" })).error).toMatch(/"Create and change tasks"/);
    expect((await tool(created.token, "list_spaces")).map((s: { id: string }) => s.id)).toEqual([team]);

    // Someone else's agent, a personal token, a space one cannot see.
    expect((await bob.patch(`/api/me/tokens/${created.id}`, { scopes: ["tasks:write"] })).status).toBe(404);
    const personal = (await alice.post("/api/me/tokens", { name: "Script", scope: "read", days: 30 })).body;
    expect((await alice.patch(`/api/me/tokens/${personal.id}`, { scopes: ["tasks:write"] })).status).toBe(404);
    expect((await alice.patch(`/api/me/tokens/${created.id}`, { scopes: [], spaceIds: ["00000000-0000-4000-8000-000000000009"] })).status).toBe(400);
  });
});

describe("pipes made over MCP", () => {
  it("are created by an agent allowed to, in its spaces, never of a confidential type", async () => {
    const reader = (await agentToken([])).body.token;
    expect((await tool(reader, "create_pipe", { spaceId: team, name: "No" })).error).toMatch(/"Create and move pipes in my spaces"/);
    const token = (await agentToken(["pipes:write"], [team])).body.token;
    const made = await tool(token, "create_pipe", { spaceId: team, name: "Hiring", kind: "rentree", withTemplates: true });
    expect(made).toMatchObject({ name: "Hiring", kind: "rentree", space: { id: team } });
    expect(made.columns.length).toBeGreaterThan(1);
    const pipe = (await alice.get(`/api/pipes/${made.id}`)).body;
    expect(pipe.name).toBe("Hiring");
    expect(pipe.tasks.length).toBeGreaterThan(0);
    // Its starter tasks are recorded as made over MCP.
    for (const t of pipe.tasks) expect(t.createdVia).toMatchObject({ kind: "agent", name: "Claude" });
    const space = (await alice.get("/api/me")).body.personalSpaceId;
    expect((await tool(token, "create_pipe", { spaceId: space, name: "Outside" })).error).toBe("Space not found");
    expect((await tool(token, "create_pipe", { spaceId: team, name: "Secret", kind: "garde_alternee" })).error).toMatch(/not found/);
  });
});

