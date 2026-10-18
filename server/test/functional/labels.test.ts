import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signIn, signInWithLink, startApp, stopApp, type Agent } from "./helpers.js";
import { migrate, pool } from "../../src/db.js";
import { runRecurrences } from "../../src/recurrence.js";
import { recordOccurrence } from "../../src/routes.js";

let app: FastifyInstance, alice: Agent, bob: Agent, carol: Agent, stranger: Agent;
let bobId: string, team: string, board: string, open: string, client: string, internal: string;

const label = (a: Agent, space: string, name: string, color = "#2bc2ff") => a.post(`/api/spaces/${space}/labels`, { name, color });
const newTask = async (a: Agent, body: Record<string, unknown>) => {
  const res = await a.post("/api/tasks", body);
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body.id as string;
};
const get = async (a: Agent, task: string) => (await a.get(`/api/tasks/${task}`)).body;
const names = (t: { labels: { name: string }[] }) => t.labels.map((l) => l.name);

beforeAll(async () => {
  app = await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  // Someone Bob invited: Alice's team is out of their sight.
  stranger = await signInWithLink((await bob.post("/api/invitations", { email: "labels-stranger@example.com", name: "Stranger" })).body.link);
  bobId = (await bob.get("/api/me")).body.user.id;
  team = (await alice.post("/api/spaces", { name: "Labels", members: [{ userId: bobId }] })).body.id;
  board = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Private board" })).body.id;
  open = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Open board", visibility: "open" })).body.id;
  client = (await label(alice, team, "Client")).body.id;
  internal = (await label(bob, team, "Internal", "#f08a24")).body.id;
});
afterAll(stopApp);

describe("labels of a space", () => {
  it("are managed by its members, with a name unique in the space", async () => {
    expect((await alice.get(`/api/spaces/${team}/labels`)).body.map((l: { name: string }) => l.name)).toEqual(["Client", "Internal"]);
    expect((await label(alice, team, "client")).body.error).toBe("A label with this name already exists");
    expect((await label(alice, team, "Red", "red")).body.error).toBe("Invalid color");
    expect((await label(alice, team, " ")).status).toBe(400);
    expect((await alice.patch(`/api/labels/${internal}`, { name: "In-house", color: "#2A9D63" })).body).toMatchObject({ name: "In-house", color: "#2a9d63" });
  });

  it("are seen by whoever sees the space, managed by no one else, and hidden from the others", async () => {
    // Carol sees the team (its open pipe) and its labels, but is not a member.
    expect((await carol.get(`/api/spaces/${team}/labels`)).status).toBe(200);
    expect((await label(carol, team, "Carol's")).status).toBe(403);
    expect((await carol.patch(`/api/labels/${client}`, { name: "Mine" })).status).toBe(403);
    expect((await carol.del(`/api/labels/${client}`)).status).toBe(403);
    for (const res of [
      await stranger.get(`/api/spaces/${team}/labels`), await label(stranger, team, "x"),
      await stranger.patch(`/api/labels/${client}`, { name: "x" }), await stranger.del(`/api/labels/${client}`),
    ]) expect(res.status).toBe(404);
    expect((await stranger.get(`/api/labels/${client}`)).status).toBe(404);
  });
});

describe("labels and priority of a task", () => {
  it("are set by those who edit the task, with labels of its space only, and recorded", async () => {
    const task = await newTask(alice, { title: "Quote", pipeId: board, priority: 2, labelIds: [client] });
    expect(await get(alice, task)).toMatchObject({ priority: 2, labels: [{ id: client, name: "Client" }] });
    expect((await bob.patch(`/api/tasks/${task}`, { priority: 1, labelIds: [client, internal] })).status).toBe(200);
    const detail = await get(alice, task);
    expect(detail.priority).toBe(1);
    expect(names(detail)).toEqual(["Client", "In-house"]);
    expect(detail.events.at(-1)).toMatchObject({ type: "fields", details: { priority: { from: 2, to: 1 }, labels: { added: ["In-house"], removed: [] } } });
    const card = (await alice.get(`/api/pipes/${board}`)).body.tasks.find((t: { id: string }) => t.id === task);
    expect(card).toMatchObject({ priority: 1, labels: [{ name: "Client" }, { name: "In-house" }] });

    // Another space's label, or a wrong priority, are refused.
    const aliceSpace = (await alice.get("/api/me")).body.personalSpaceId;
    const mine = (await label(alice, aliceSpace, "Personal label")).body.id;
    expect((await alice.patch(`/api/tasks/${task}`, { labelIds: [mine] })).body.error).toBe("Invalid label");
    expect((await alice.patch(`/api/tasks/${task}`, { priority: 7 })).body.error).toBe("Invalid priority");
    expect((await alice.patch(`/api/tasks/${task}`, { labelIds: ["not-an-id"] })).status).toBe(400);
    // Carol cannot even see the task.
    expect((await carol.patch(`/api/tasks/${task}`, { priority: 4 })).status).toBe(404);
  });

  it("are set on an open pipe's task by its author, not by others", async () => {
    const carols = await newTask(carol, { title: "Carol's request", pipeId: open, priority: 3, labelIds: [client] });
    expect((await carol.patch(`/api/tasks/${carols}`, { labelIds: [] })).status).toBe(200);
    const alices = await newTask(alice, { title: "Alice's, open", pipeId: open });
    expect((await carol.patch(`/api/tasks/${alices}`, { priority: 1 })).status).toBe(403);
    expect((await carol.patch(`/api/tasks/${alices}`, { labelIds: [client] })).status).toBe(403);
  });

  it("are not put on a task sent to someone else's incoming", async () => {
    const bobSpace = (await bob.get("/api/me")).body.personalSpaceId;
    const bobs = (await label(bob, bobSpace, "Bob's label")).body.id;
    expect((await alice.post("/api/tasks", { title: "For Bob", spaceId: bobSpace, labelIds: [bobs] })).status).toBe(403);
    expect((await alice.post("/api/tasks", { title: "For Bob", spaceId: bobSpace, labelIds: [client] })).body.error).toBe("Invalid label");
    // A priority travels.
    const sent = await newTask(alice, { title: "For Bob", spaceId: bobSpace, priority: 2 });
    expect((await get(bob, sent)).priority).toBe(2);
  });

  it("leave a task sent to another space, recorded in its history", async () => {
    const task = await newTask(alice, { title: "Leaves", pipeId: board, labelIds: [client] });
    const carolSpace = (await carol.get("/api/me")).body.personalSpaceId;
    expect((await alice.post(`/api/tasks/${task}/send`, { spaceId: carolSpace })).status).toBe(200);
    const detail = await get(carol, task);
    expect(detail.labels).toEqual([]);
    expect(detail.events.at(-1)).toMatchObject({ type: "sent", details: { labels: { removed: ["Client"] } } });
  });

  it("are taken off tasks when deleted", async () => {
    const temp = (await label(alice, team, "Temporary")).body.id;
    const task = await newTask(alice, { title: "Tagged", pipeId: board, labelIds: [temp, client] });
    expect((await bob.del(`/api/labels/${temp}`)).status).toBe(200);
    expect(names(await get(alice, task))).toEqual(["Client"]);
  });

  it("are copied to the next task of a series", async () => {
    const task = await newTask(alice, { title: "Weekly sync", pipeId: board, dueDate: "2026-10-19", priority: 3, labelIds: [internal] });
    const r = (await alice.put(`/api/tasks/${task}/recurrence`, { rule: { freq: "daily" } })).body;
    await runRecurrences(recordOccurrence, new Date("2026-10-20T08:00:00Z"));
    const { rows } = await pool.query(`SELECT id FROM tasks WHERE recurrence_id = $1 AND id <> $2`, [r.id, task]);
    expect(await get(alice, rows[0].id)).toMatchObject({ priority: 3, labels: [{ name: "In-house" }] });
    // Stopped, so that other test files' passes do not make its tasks.
    await alice.del(`/api/tasks/${task}/recurrence`);
  });
});

describe("filters and export", () => {
  it("find tasks by label name and priority in the search", async () => {
    await newTask(alice, { title: "Zanzibar visit", pipeId: board, priority: 1, labelIds: [client] });
    await newTask(alice, { title: "Zanzibar notes", pipeId: board });
    const found = async (q: string) => ((await alice.get(`/api/search?q=zanzibar${q}`)).body as { title: string }[]).map((t) => t.title).sort();
    expect(await found("")).toEqual(["Zanzibar notes", "Zanzibar visit"]);
    expect(await found("&label=client")).toEqual(["Zanzibar visit"]);
    expect(await found("&priority=1")).toEqual(["Zanzibar visit"]);
    expect(await found("&priority=0")).toEqual(["Zanzibar notes"]);
    expect((await alice.get(`/api/search?q=zanzibar&priority=9`)).status).toBe(400);
    expect((await alice.get("/api/me/labels")).body.map((l: { name: string }) => l.name)).toEqual(expect.arrayContaining(["Client", "In-house"]));
    // Labels of spaces one is not a member of are not offered.
    expect((await carol.get("/api/me/labels")).body.map((l: { name: string }) => l.name)).not.toContain("Client");
  });

  it("are exported with the pipe", async () => {
    const csv = (await app.inject({ method: "GET", url: `/api/pipes/${board}/export?sep=,`, headers: { cookie: alice.cookie } })).body;
    const [head, ...lines] = csv.replace(/^﻿/, "").split("\r\n");
    expect(head).toContain("Priority,Labels,");
    // Then its estimate and logged time, none here.
    expect(lines.find((l) => l.includes("Zanzibar visit"))).toContain("Urgent,Client,,,Alice Martin");
  });
});

describe("the user stories' priority field", () => {
  it("is copied once into the priority", async () => {
    const dev = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Software", kind: "dev" })).body.id;
    const story = await newTask(alice, { title: "Old story", pipeId: dev, taskType: "user_story" });
    await pool.query(`UPDATE tasks SET fields = '{"priorite": "Haute"}', priority = NULL WHERE id = $1`, [story]);
    await pool.query(`DELETE FROM schema_steps WHERE name = 'user-story-priority'`);
    await migrate(app.log);
    expect((await get(alice, story)).priority).toBe(2);
    // Once only: clearing the priority sticks.
    await alice.patch(`/api/tasks/${story}`, { priority: null });
    await migrate(app.log);
    expect((await get(alice, story)).priority).toBeNull();
  });
});
