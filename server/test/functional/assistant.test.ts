/** The AI assistant on a task (POST /api/tasks/:id/assist), against a fake AI server: a proposal, never saved. */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { loadSettings, pool } from "../../src/db.js";

let alice: Agent, bob: Agent, carol: Agent, board: string, secret: string;
let server: http.Server, url = "";
let answer = "";
/** Answers given in turn before `answer` (several calls in one request). */
let queue: string[] = [];
const prompts: any[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      prompts.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: queue.shift() ?? answer } }] }));
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

  it("asks its questions, discusses the task, and completes it with the answers", async () => {
    const id = (await alice.post("/api/tasks", { title: "Export", pipeId: board, description: "Export the board." })).body.id;
    answer = JSON.stringify({ questions: [{ question: "Which format?", options: ["CSV", "Excel"] }, { question: "" }] });
    const asked = await alice.post(`/api/tasks/${id}/assist/questions`);
    expect(asked.body).toEqual({ questions: [{ question: "Which format?", options: ["CSV", "Excel"] }] });

    answer = "Both are possible; CSV is simpler.";
    const said = await alice.post(`/api/tasks/${id}/assist/discussion`, {
      messages: [{ role: "user", content: "Which one do you advise?" }],
    });
    expect(said.body).toEqual({ reply: "Both are possible; CSV is simpler." });
    const chat = prompts.at(-1);
    expect(chat.messages[0].content).toContain("Export the board.");
    expect(chat.messages.at(-1)).toEqual({ role: "user", content: "Which one do you advise?" });
    expect((await alice.post(`/api/tasks/${id}/assist/discussion`, { messages: [] })).body.error).toBe("Write a message first");

    answer = JSON.stringify({ description: "Export the board as CSV." });
    const proposal = await alice.post(`/api/tasks/${id}/assist`, { answers: [{ question: "Which format?", answer: "CSV" }] });
    expect(proposal.body).toEqual({ description: "Export the board as CSV." });
    expect(prompts.at(-1).messages[1].content).toContain('"answer":"CSV"');
  });

  it("answers a question about one's tasks from those the search finds, never confidential ones", async () => {
    const invoice = (await alice.post("/api/tasks", { title: "Send the Zorglub invoice", pipeId: board })).body.id;
    await alice.post("/api/tasks", { title: "Zorglub learner file", pipeId: (await alice.get(`/api/tasks/${secret}`)).body.pipe.id });
    const key = (await alice.get(`/api/tasks/${invoice}`)).body.key;
    queue = [JSON.stringify({ queries: ["zorglub", ""] }), JSON.stringify({ answer: `See ${key}.`, tasks: [key, "TP-999999"] })];
    const res = await alice.post("/api/search/assistant", { question: "What is left to do for Zorglub?" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.answer).toBe(`See ${key}.`);
    expect(res.body.tasks.map((t: { id: string }) => t.id)).toEqual([invoice]);
    const sent = JSON.parse(prompts.at(-1).messages[1].content);
    expect(sent.question).toBe("What is left to do for Zorglub?");
    expect(sent.tasks.map((t: { title: string }) => t.title)).toEqual(["Send the Zorglub invoice"]);
    // Carol sees none of these tasks: the AI is not even asked to answer.
    queue = [JSON.stringify({ queries: ["zorglub"] })];
    const before = prompts.length;
    expect((await carol.post("/api/search/assistant", { question: "Zorglub?" })).body).toEqual({ answer: null, tasks: [] });
    expect(prompts.length).toBe(before + 1);
    expect((await alice.post("/api/search/assistant", { question: " " })).body.error).toBe("Ask a question first");
  });

  it("tells when the answer cannot be read", async () => {
    answer = "Sorry, I can't.";
    const id = (await alice.post("/api/tasks", { title: "z", pipeId: board })).body.id;
    expect((await alice.post(`/api/tasks/${id}/assist`)).body.error).toBe("The AI's answer could not be read");
  });
});
