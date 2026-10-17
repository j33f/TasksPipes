import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

let alice: Agent, bob: Agent;

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
});
afterAll(stopApp);

describe("model files", () => {
  it("export a pipe type with the custom task types it offers, and import them elsewhere", async () => {
    const task = (await alice.post("/api/catalog/task-types", { label: "Company visit", fields: [{ label: "Result", type: "select", options: ["OK", "To redo"] }] })).body.id;
    const pipe = (await alice.post("/api/catalog/pipe-types", {
      label: "Work-study (export)", columns: [{ label: "To plan", status: "backlog" }, { label: "Done", status: "done" }], taskTypes: [task, "cours"],
    })).body.id;

    const res = await alice.get(`/api/catalog/export?pipeTypes=${pipe}`);
    expect(res.status).toBe(200);
    const file = parse(res.body);
    expect(file.taskTypes.map((t: { label: string }) => t.label)).toEqual(["Company visit"]);
    expect(file.pipeTypes[0].taskTypes).toEqual([task, "cours"]);

    const imported = await bob.post("/api/catalog/import", { yaml: res.body });
    expect(imported.status).toBe(200);
    expect(imported.body.created.map((c: { kind: string; label: string }) => `${c.kind}:${c.label}`)).toEqual(["task:Company visit", "pipe:Work-study (export)"]);

    const catalog = (await bob.get("/api/catalog")).body;
    const newPipe = catalog.pipeTypes.find((p: { id: string }) => p.id === imported.body.created[1].id);
    const newTask = imported.body.created[0].id;
    expect(newPipe).toMatchObject({ visibility: "private", createdBy: { name: "Bob Durand" } });
    expect(newPipe.taskTypes).toEqual([newTask, "cours"]); // the copy of the task type, not Alice's
    expect(newPipe.columns.map((c: { label: string }) => c.label)).toEqual(["To plan", "Done"]);
  });

  it("import all or nothing", async () => {
    const before = (await bob.get("/api/catalog")).body.taskTypes.length;
    const yaml = `taskspipes: 1
taskTypes:
  - id: ok
    label: Fine
pipeTypes:
  - label: Broken
    columns:
      - { label: Only one, status: backlog }
`;
    const res = await bob.post("/api/catalog/import", { yaml });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("At least two columns are needed");
    expect((await bob.get("/api/catalog")).body.taskTypes.length).toBe(before);
  });

  it("refuse other people's private models in exports and imports", async () => {
    const secret = (await alice.post("/api/catalog/task-types", { label: "Secret" })).body.id;
    expect((await bob.get(`/api/catalog/export?taskTypes=${secret}`)).status).toBe(400);
    const yaml = `taskspipes: 1\npipeTypes:\n  - label: Sneaky\n    columns: [{ label: A, status: backlog }, { label: B, status: done }]\n    taskTypes: [${secret}]\n`;
    expect((await bob.post("/api/catalog/import", { yaml })).body.error).toBe("Unknown task type: {id}".replace("{id}", secret));
  });

  it("explain what is wrong with a file, in the page's language", async () => {
    const fr = await signIn("bob-token", "fr");
    expect((await fr.post("/api/catalog/import", { yaml: "hello" })).body.error).toBe("Ce fichier n'est pas un fichier de modèles TasksPipes");
  });
});
