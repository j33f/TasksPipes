import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

let alice: Agent, bob: Agent;
const columns = [
  { label: "To plan", status: "backlog" },
  { label: "Visit done", status: "ongoing" },
  { label: "Closed", status: "done" },
];

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
});
afterAll(stopApp);

describe("models", () => {
  let taskType: string, pipeType: string;

  it("are created private, usable by their author only", async () => {
    taskType = (await alice.post("/api/catalog/task-types", { label: "Visit", fields: [{ label: "Company", type: "text" }] })).body.id;
    pipeType = (await alice.post("/api/catalog/pipe-types", { label: "Work-study", columns, taskTypes: [taskType] })).body.id;
    const catalog = (await alice.get("/api/catalog")).body;
    expect(catalog.pipeTypes.find((p: { id: string }) => p.id === pipeType)).toMatchObject({ custom: true, visibility: "private", group: "Custom models" });
    const bobSpace = (await bob.get("/api/me")).body.personalSpaceId;
    expect((await bob.post(`/api/spaces/${bobSpace}/pipes`, { name: "x", kind: pipeType })).body.error).toBe("Invalid pipe type");
    expect((await bob.put(`/api/catalog/pipe-types/${pipeType}`, { label: "Hijack", columns })).status).toBe(403);
  });

  it("keep a work in progress limit per column", async () => {
    const limited = [{ label: "Doing", status: "ongoing", wipLimit: 3 }, { label: "Done", status: "done" }];
    const id = (await alice.post("/api/catalog/pipe-types", { label: "Limited", columns: limited })).body.id;
    const type = (await alice.get("/api/catalog")).body.pipeTypes.find((p: { id: string }) => p.id === id);
    expect(type.columns.map((c: { wipLimit?: number }) => c.wipLimit)).toEqual([3, undefined]);
    expect((await alice.put(`/api/catalog/pipe-types/${id}`, { label: "Limited", columns: [{ ...limited[0], wipLimit: 0 }, limited[1]] })).body.error)
      .toBe("Column 1: the limit is a number from 1 to 999");
  });

  it("move tasks to the nearest column when a column is removed", async () => {
    const space = (await alice.get("/api/me")).body.personalSpaceId;
    const pipe = (await alice.post(`/api/spaces/${space}/pipes`, { name: "Apprentices", kind: pipeType })).body.id;
    const task = (await alice.post("/api/tasks", { title: "Visit ACME", pipeId: pipe, stage: "visit_done" })).body.id;
    const kept = [{ id: "to_plan", label: "To plan", status: "backlog" }, { id: "closed", label: "Closed", status: "done" }, { label: "Visiting", status: "started" }];
    expect((await alice.put(`/api/catalog/pipe-types/${pipeType}`, { label: "Work-study", columns: kept, taskTypes: [taskType] })).status).toBe(200);
    expect((await alice.get(`/api/tasks/${task}`)).body).toMatchObject({ stage: "visiting", status: "started" });
  });

  it("cannot be deleted while used, nor change a saved field's kind", async () => {
    expect((await alice.del(`/api/catalog/pipe-types/${pipeType}`)).status).toBe(400);
    expect((await alice.del(`/api/catalog/task-types/${taskType}`)).status).toBe(400);
    const res = await alice.put(`/api/catalog/task-types/${taskType}`, { label: "Visit", fields: [{ id: "company", label: "Company", type: "number" }] });
    expect(res.status).toBe(400);
  });

  it("become usable by everyone once public", async () => {
    await alice.put(`/api/catalog/pipe-types/${pipeType}`, { label: "Work-study", visibility: "public", columns: [{ id: "to_plan", label: "To plan", status: "backlog" }, { id: "closed", label: "Closed", status: "done" }], taskTypes: [taskType] });
    const bobSpace = (await bob.get("/api/me")).body.personalSpaceId;
    expect((await bob.post(`/api/spaces/${bobSpace}/pipes`, { name: "Mine", kind: pipeType })).status).toBe(200);
  });

  it("can be turned off per person, with the task types only they offered", async () => {
    const res = await alice.put("/api/me/disabled-pipe-types", { pipeTypes: ["examen", "general"] });
    expect(res.body.pipeTypes).toEqual(["examen"]);
    const catalog = (await alice.get("/api/catalog")).body;
    const off = (list: { id: string; disabled: boolean }[]) => list.filter((x) => x.disabled).map((x) => x.id);
    expect(off(catalog.pipeTypes)).toEqual(["examen"]);
    expect(off(catalog.taskTypes)).toEqual(["session_examen"]); // "epreuve" is still offered by instructional design
    expect(off((await bob.get("/api/catalog")).body.pipeTypes)).toEqual([]);
  });
});

describe("catalog", () => {
  it("comes in the language of the page", async () => {
    const en = (await alice.get("/api/catalog")).body.pipeTypes.find((p: { id: string }) => p.id === "commercial");
    expect(en.label).toBe("Commercial");
    expect(en.columns[0].label).toBe("Request");
    const frAlice = await signIn("alice-token", "fr");
    const fr = (await frAlice.get("/api/catalog")).body.pipeTypes.find((p: { id: string }) => p.id === "commercial");
    expect(fr.columns[0].label).toBe("Demande");
  });
});
