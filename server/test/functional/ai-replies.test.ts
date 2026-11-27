/**
 * The instance's AI answering for a person's agent (ai-replies.ts), against a fake AI server: only for those who chose
 * it, one comment via the agent (an answer or questions), nothing when no comment is useful, never in reply to
 * itself, never on a confidential task.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { loadSettings, pool } from "../../src/db.js";
import { overrideSetting } from "../../src/settings-store.js";
import { runAiReplies } from "../../src/ai-replies.js";
import { commentTask } from "../../src/routes.js";

let alice: Agent, bob: Agent, aliceId: string, board: string, secretPipe: string;
let server: http.Server;
let queue: string[] = [];
const prompts: any[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      prompts.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: queue.shift() ?? '{"comment": null}' } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  await startApp();
  overrideSetting("mcp.enabled", true);
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  const me = (await alice.get("/api/me")).body;
  aliceId = me.user.id;
  const bobId = (await bob.get("/api/me")).body.user.id;
  const team = (await alice.post("/api/spaces", { name: "AI replies", members: [{ userId: bobId }] })).body.id;
  board = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Board" })).body.id;
  secretPipe = (await alice.post(`/api/spaces/${me.personalSpaceId}/pipes`, { name: "Garde", kind: "garde_alternee" })).body.id;
  await alice.post("/api/me/tokens", { name: "Claude", kind: "agent", scopes: ["comments:write"], days: 30 });
  await alice.put("/api/admin/settings", {
    settings: { "ai.provider": "other", "ai.url": url, "ai.api": "openai", "ai.apiKey": "k", "ai.model": "m", "ai.allowPrivate": true },
  });
  // The first pass starts after everything done so far.
  await runAiReplies(commentTask);
});

afterAll(async () => {
  overrideSetting("mcp.enabled", undefined);
  await pool.query(`DELETE FROM instance_settings WHERE key LIKE 'ai.%'`);
  await pool.query(`UPDATE users SET ai_replies = false`);
  await loadSettings();
  await stopApp();
  server.close();
});

const comments = async (id: string) =>
  ((await alice.get(`/api/tasks/${id}`)).body.events as { type: string; comment?: string; via?: { kind: string } }[]).filter((e) => e.type === "comment");

describe("the instance's AI answering for an agent", () => {
  it("is off until the person chooses it", async () => {
    expect((await alice.get("/api/me")).body.aiReplies).toBe(false);
    const id = (await alice.post("/api/tasks", { title: "Not yet", pipeId: board, assigneeId: aliceId })).body.id;
    await alice.patch(`/api/tasks/${id}`, { assigneeAgent: true });
    const before = prompts.length;
    expect(await runAiReplies(commentTask)).toBe(0);
    expect(prompts.length).toBe(before);
    expect((await alice.patch("/api/me", { aiReplies: true })).status).toBe(200);
    expect((await alice.get("/api/me")).body.aiReplies).toBe(true);
  });

  it("asks its questions when a task is handed to the agent, answers comments, and stays quiet otherwise", async () => {
    const id = (await alice.post("/api/tasks", { title: "Fix the export", pipeId: board, assigneeId: aliceId, description: "It fails." })).body.id;
    await alice.patch(`/api/tasks/${id}`, { assigneeAgent: true });
    queue = [JSON.stringify({ comment: "1. Which format fails?\n2. Since when?" })];
    expect(await runAiReplies(commentTask)).toBe(1);
    const sent = JSON.parse(prompts.at(-1).messages[1].content);
    expect(sent).toMatchObject({ task: { title: "Fix the export", description: "It fails." }, event: { event: "handed to you" } });
    expect(prompts.at(-1).messages[0].content).toContain("Alice Martin (MCP)");
    let list = await comments(id);
    expect(list.at(-1)).toMatchObject({ comment: "1. Which format fails?\n2. Since when?", via: { kind: "agent" } });

    // Bob answers: the AI reads it; its own comment never comes back to it.
    await bob.post(`/api/tasks/${id}/comments`, { body: "CSV, since yesterday. Thanks!" });
    queue = ['{"comment": null}'];
    const before = prompts.length;
    expect(await runAiReplies(commentTask)).toBe(0);
    expect(prompts.length).toBe(before + 1);
    expect(JSON.parse(prompts.at(-1).messages[1].content).event).toEqual({ event: "comment", by: "Bob Durand", comment: "CSV, since yesterday. Thanks!" });
    expect(await runAiReplies(commentTask)).toBe(0);
    expect(prompts.length).toBe(before + 1);
    list = await comments(id);
    expect(list).toHaveLength(2);
  });

  it("never sees a confidential task", async () => {
    const id = (await alice.post("/api/tasks", { title: "Secret", pipeId: secretPipe })).body.id;
    await alice.patch(`/api/tasks/${id}`, { assigneeAgent: true });
    await alice.post(`/api/tasks/${id}/comments`, { body: "Hidden" });
    const before = prompts.length;
    expect(await runAiReplies(commentTask)).toBe(0);
    expect(prompts.length).toBe(before);
  });
});
