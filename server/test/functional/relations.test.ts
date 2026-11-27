import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

// Related tasks (POST/DELETE /api/tasks/:id/relations): linked both ways, neither waiting for the other.
let alice: Agent, bob: Agent, carol: Agent, board: string, carolTask: string;

const newTask = async (a: Agent, pipeId: string, title: string) => (await a.post("/api/tasks", { title, pipeId })).body.id as string;
const relate = (a: Agent, task: string, taskId: string) => a.post(`/api/tasks/${task}/relations`, { taskId });

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  const bobId = (await bob.get("/api/me")).body.user.id;
  const team = (await alice.post("/api/spaces", { name: "Relations", members: [{ userId: bobId }] })).body.id;
  board = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Board" })).body.id;
  const carolPipe = (await carol.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
  carolTask = await newTask(carol, carolPipe, "Carol's secret");
});
afterAll(stopApp);

describe("related tasks", () => {
  it("show on both tasks, block nothing, and can be removed from either side", async () => {
    const a = await newTask(alice, board, "Front");
    const b = await newTask(alice, board, "Back");
    const res = await relate(alice, a, b);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.related).toMatchObject([{ id: b, title: "Back", visible: true }]);
    expect(res.body.blockedBy).toEqual([]);
    // Relating again, either way, changes nothing.
    await relate(bob, b, a);
    const detailA = (await alice.get(`/api/tasks/${a}`)).body;
    expect(detailA.related.map((d: { id: string }) => d.id)).toEqual([b]);
    expect(detailA.blockers).toBe(0);
    expect(detailA.events.filter((e: { type: string }) => e.type === "dependency")).toHaveLength(1);
    expect((await bob.get(`/api/tasks/${b}`)).body.related).toMatchObject([{ id: a, title: "Front" }]);

    const gone = await bob.del(`/api/tasks/${b}/relations/${a}`);
    expect(gone.status).toBe(200);
    expect(gone.body.related).toEqual([]);
    expect((await alice.get(`/api/tasks/${a}`)).body.related).toEqual([]);
  });

  it("refuses a task related to itself, and one the person cannot open", async () => {
    const a = await newTask(alice, board, "Alone");
    expect((await relate(alice, a, a)).status).toBe(400);
    expect((await relate(alice, a, carolTask)).status).toBe(404);
    // Nor may someone who cannot edit the task relate it.
    expect((await relate(carol, a, carolTask)).status).toBe(404);
  });
});
