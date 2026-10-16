import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

let alice: Agent, bob: Agent, carol: Agent;
let alicePipe: string, bobSpace: string;

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  alicePipe = (await alice.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
  bobSpace = (await bob.get("/api/me")).body.personalSpaceId;
});
afterAll(stopApp);

describe("tasks", () => {
  it("are created in a pipe, moved between columns and recorded in the history", async () => {
    const { body } = await alice.post("/api/tasks", { title: "Write the syllabus", pipeId: alicePipe, dueDate: "2030-01-15" });
    const id = body.id;
    expect((await alice.patch(`/api/tasks/${id}`, { stage: "ongoing" })).status).toBe(200);
    const task = (await alice.get(`/api/tasks/${id}`)).body;
    expect(task).toMatchObject({ title: "Write the syllabus", stage: "ongoing", status: "ongoing", dueDate: "2030-01-15" });
    expect(task.events.map((e: { type: string }) => e.type)).toEqual(["created", "status"]);
    expect(task.assignee.name).toBe("Alice Martin");
  });

  it("need a title and a valid due date", async () => {
    expect((await alice.post("/api/tasks", { title: " ", pipeId: alicePipe })).body.error).toBe("Title is required");
    expect((await alice.post("/api/tasks", { title: "x", pipeId: alicePipe, dueDate: "tomorrow" })).body.error).toBe("Invalid due date");
  });

  it("of a private pipe stay hidden from others", async () => {
    const { body } = await alice.post("/api/tasks", { title: "Private", pipeId: alicePipe });
    expect((await carol.get(`/api/tasks/${body.id}`)).status).toBe(404);
  });

  it("can be sent, accepted, or refused back to the sender", async () => {
    const sent = (await alice.post("/api/tasks", { title: "Check the rooms", spaceId: bobSpace, comment: "please" })).body.id;
    const incoming = (await bob.get(`/api/spaces/${bobSpace}`)).body.incoming;
    expect(incoming.map((t: { id: string }) => t.id)).toContain(sent);

    const refused = await bob.post(`/api/tasks/${sent}/refuse`, { reason: "Not mine" });
    expect(refused.status).toBe(200);
    const back = (await alice.get(`/api/tasks/${sent}`)).body;
    expect(back.inIncoming).toBe(true);
    expect(back.events.at(-1)).toMatchObject({ type: "refused", comment: "Not mine" });

    const again = (await alice.post(`/api/tasks/${sent}/send`, { spaceId: bobSpace })).status;
    expect(again).toBe(200);
    const bobPipe = (await bob.get("/api/sidebar")).body.mine[0].id;
    expect((await bob.post(`/api/tasks/${sent}/move`, { pipeId: bobPipe })).status).toBe(200);
    expect((await bob.get(`/api/tasks/${sent}`)).body).toMatchObject({ inIncoming: false, pipe: { id: bobPipe } });
  });

  it("only the recipient can refuse", async () => {
    const id = (await alice.post("/api/tasks", { title: "Mine to refuse", spaceId: bobSpace })).body.id;
    expect((await carol.post(`/api/tasks/${id}/refuse`, { reason: "x" })).status).toBe(404);
  });

  it("hold sub-tasks, whose checking is recorded", async () => {
    const id = (await alice.post("/api/tasks", { title: "Open day", pipeId: alicePipe, items: ["Posters", { text: "Room", done: true }] })).body.id;
    const item = (await alice.post(`/api/tasks/${id}/items`, { text: "Coffee" })).body.id;
    await alice.patch(`/api/items/${item}`, { done: true });
    const task = (await alice.get(`/api/tasks/${id}`)).body;
    expect(task.items.map((i: { text: string; done: boolean }) => [i.text, i.done])).toEqual([["Posters", false], ["Room", true], ["Coffee", true]]);
    expect(task.checklist).toMatchObject({ total: 3, done: 2, next: { text: "Posters" } });
    expect(task.events.at(-1)).toMatchObject({ type: "checklist", details: { item: "Coffee", done: true } });
    expect((await carol.patch(`/api/items/${item}`, { done: false })).status).toBe(404);
  });

  it("show up in My tasks while open", async () => {
    const id = (await alice.post("/api/tasks", { title: "Listed", pipeId: alicePipe })).body.id;
    expect((await alice.get("/api/me/tasks")).body.map((t: { id: string }) => t.id)).toContain(id);
    await alice.patch(`/api/tasks/${id}`, { stage: "done" });
    expect((await alice.get("/api/me/tasks")).body.map((t: { id: string }) => t.id)).not.toContain(id);
  });

  it("keep typed fields and refuse wrong values", async () => {
    const space = (await alice.get("/api/me")).body.personalSpaceId;
    const pipe = (await alice.post(`/api/spaces/${space}/pipes`, { name: "Sales", kind: "commercial" })).body.id;
    const ok = await alice.post("/api/tasks", { title: "ACME", pipeId: pipe, taskType: "opportunite", fields: { stagiaires: "12", financement: "OPCO" } });
    expect((await alice.get(`/api/tasks/${ok.body.id}`)).body.fields).toEqual({ stagiaires: 12, financement: "OPCO" });
    const bad = await alice.post("/api/tasks", { title: "x", pipeId: pipe, taskType: "opportunite", fields: { financement: "Bitcoin" } });
    expect(bad.body.error).toBe("Funding: invalid choice");
  });
});

describe("pipes", () => {
  it("are archived only once their tasks are finished", async () => {
    const space = (await alice.get("/api/me")).body.personalSpaceId;
    const pipe = (await alice.post(`/api/spaces/${space}/pipes`, { name: "Short-lived" })).body.id;
    const task = (await alice.post("/api/tasks", { title: "Open", pipeId: pipe })).body.id;
    expect((await alice.patch(`/api/pipes/${pipe}`, { archived: true })).status).toBe(400);
    await alice.patch(`/api/tasks/${task}`, { stage: "done" });
    expect((await alice.patch(`/api/pipes/${pipe}`, { archived: true })).status).toBe(200);
    expect((await alice.post("/api/tasks", { title: "Late", pipeId: pipe })).body.error).toBe("This pipe is archived");
  });

  it("cannot archive or delete the default pipe", async () => {
    expect((await alice.patch(`/api/pipes/${alicePipe}`, { archived: true })).status).toBe(400);
    expect((await alice.del(`/api/pipes/${alicePipe}`)).status).toBe(400);
  });

  it("fill process pipes with their starter tasks, in the creator's language", async () => {
    const space = (await alice.get("/api/me")).body.personalSpaceId;
    const pipe = (await alice.post(`/api/spaces/${space}/pipes`, { name: "Start", kind: "rentree", withTemplates: true })).body.id;
    const tasks = (await alice.get(`/api/pipes/${pipe}`)).body.tasks;
    expect(tasks.length).toBeGreaterThan(5);
    expect(tasks[0].title).toMatch(/^[A-Z][a-z]/); // English, not "Valider…"
    expect(tasks[0].title).not.toMatch(/^Valider/);
  });
});
