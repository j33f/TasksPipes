/** The AI assistant on a task (POST /api/tasks/:id/assist), against a fake AI server: a proposal, never saved. */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { loadSettings, pool } from "../../src/db.js";

let alice: Agent, bob: Agent, carol: Agent, board: string, secret: string;
let server: http.Server, url = "";
let answer = "";
const prompts: any[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      prompts.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  const bobId = (await bob.get("/api/me")).body.user.id;
  const team = (await alice.post("/api/spaces", { name: "Assistant", members: [{ userId: bobId }] })).body.id;
  board = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Product", kind: "dev" })).body.id;
  const follow = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Learners", kind: "suivi" })).body.id;
  secret = (await alice.post("/api/tasks", { title: "A learner", pipeId: follow })).body.id;
});
afterAll(async () => {
  await pool.query(`DELETE FROM instance_settings WHERE key LIKE 'ai.%'`);
  await loadSettings();
  await stopApp();
  server.close();
});

const connect = () => alice.put("/api/admin/settings", {
  settings: { "ai.provider": "other", "ai.url": url, "ai.api": "openai", "ai.apiKey": "k", "ai.model": "m", "ai.allowPrivate": true },
});

describe("the AI assistant on a task", () => {
  it("needs an AI set up", async () => {
    const id = (await alice.post("/api/tasks", { title: "x", pipeId: board })).body.id;
    expect((await alice.post(`/api/tasks/${id}/assist`)).body.error).toBe("No AI assistant is set up on this instance");
    expect((await connect()).status).toBe(200);
  });

  it("proposes a title, description and fields from the task and its comments, following the type's rules", async () => {
    const id = (await alice.post("/api/tasks", { title: "save shortcut", pipeId: board, taskType: "user_story", description: "ctrl enter to save" })).body.id;
    await alice.post(`/api/tasks/${id}/comments`, { body: "Also on comments, please." });
    answer = "```json\n" + JSON.stringify({
      title: "Ctrl+Enter saves what is being edited",
      description: "Ctrl+Enter saves the description and comments.",
      fields: { role: "utilisateur", besoin: "enregistrer au clavier", files: "nope" },
      notes: "No version given.",
    }) + "\n```";
    const res = await alice.post(`/api/tasks/${id}/assist`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      title: "Ctrl+Enter saves what is being edited",
      description: "Ctrl+Enter saves the description and comments.",
      fields: { role: "utilisateur", besoin: "enregistrer au clavier" },
      notes: "No version given.",
    });
    const sent = prompts.at(-1);
    const system = sent.messages[0].content as string;
    expect(system).toContain("Titres courts et assertifs"); // the dev pipe's rules
    expect(system).toContain("En tant que…"); // the user story's rules
    const facts = JSON.parse(sent.messages[1].content);
    expect(facts).toMatchObject({ title: "save shortcut", description: "ctrl enter to save", comments: [{ text: "Also on comments, please." }] });
    expect(facts.fields.map((f: { id: string }) => f.id)).toContain("criteres");
    // Nothing was saved.
    expect((await alice.get(`/api/tasks/${id}`)).body.title).toBe("save shortcut");
  });

  it("is for those who may edit the task", async () => {
    const id = (await alice.post("/api/tasks", { title: "y", pipeId: board })).body.id;
    answer = JSON.stringify({ title: "Y" });
    expect((await bob.post(`/api/tasks/${id}/assist`)).body).toEqual({ title: "Y" });
    expect((await carol.post(`/api/tasks/${id}/assist`)).status).toBe(404);
  });

  it("never sends a confidential task", async () => {
    const before = prompts.length;
    const res = await alice.post(`/api/tasks/${secret}/assist`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("The AI assistant never sees confidential tasks");
    expect(prompts.length).toBe(before);
  });

  it("tells when the answer cannot be read", async () => {
    answer = "Sorry, I can't.";
    const id = (await alice.post("/api/tasks", { title: "z", pipeId: board })).body.id;
    expect((await alice.post(`/api/tasks/${id}/assist`)).body.error).toBe("The AI's answer could not be read");
  });
});
