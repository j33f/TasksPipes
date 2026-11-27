import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

// Someone else's "My tasks" (GET /api/users/:id/tasks): what they own and still have to do, among the tasks one sees.
let alice: Agent, bob: Agent, dave: Agent;
const ids: Record<string, string> = {};
let teamPipe: string, alicePipe: string;

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  dave = await signIn("dave-token");
  for (const [n, a] of [["alice", alice], ["bob", bob], ["dave", dave]] as const) ids[n] = (await a.get("/api/me")).body.user.id;
  const team = (await alice.post("/api/spaces", { name: "User tasks team", members: [{ userId: ids.bob }] })).body.id;
  teamPipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Team board" })).body.id;
  alicePipe = (await alice.post(`/api/spaces/${(await alice.get("/api/me")).body.personalSpaceId}/pipes`, { name: "Alice's own" })).body.id;
});
afterAll(stopApp);

const create = async (who: Agent, body: Record<string, unknown>) => {
  const r = await who.post("/api/tasks", body);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.id as string;
};
const taskIds = (body: { id: string }[]) => body.map((t) => t.id);

describe("GET /api/users/:id/tasks", () => {
  it("shows a teammate's open tasks one may see, not their private ones nor finished ones", async () => {
    const teamTask = await create(bob, { title: "for alice in the team", pipeId: teamPipe, assigneeId: ids.alice });
    const bobsOwn = await create(bob, { title: "for bob in the team", pipeId: teamPipe, assigneeId: ids.bob });
    const privateTask = await create(alice, { title: "alice private", pipeId: alicePipe });
    const doneTask = await create(bob, { title: "done for alice", pipeId: teamPipe, assigneeId: ids.alice, status: "done" });

    const res = await bob.get(`/api/users/${ids.alice}/tasks`);
    expect(res.status).toBe(200);
    const seen = taskIds(res.body);
    expect(seen).toContain(teamTask);
    expect(seen).not.toContain(bobsOwn);
    expect(seen).not.toContain(privateTask);
    expect(seen).not.toContain(doneTask);

    // Alice herself sees her private task there too, as in "My tasks".
    const own = taskIds((await alice.get(`/api/users/${ids.alice}/tasks`)).body);
    expect(own).toEqual(expect.arrayContaining([teamTask, privateTask]));
  });

  it("shows someone outside her spaces none of them", async () => {
    const res = await dave.get(`/api/users/${ids.alice}/tasks`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("refuses an unknown person, and a bad id", async () => {
    expect((await alice.get("/api/users/00000000-0000-4000-8000-000000000000/tasks")).status).toBe(404);
    expect((await alice.get("/api/users/not-a-uuid/tasks")).status).toBe(400);
  });
});
