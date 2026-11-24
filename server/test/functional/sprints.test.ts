import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

let app: FastifyInstance, alice: Agent, bob: Agent, carol: Agent;
let team: string, board: string, general: string, other: string;

const newTask = async (a: Agent, body: Record<string, unknown>) => {
  const res = await a.post("/api/tasks", body);
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body.id as string;
};
const get = async (a: Agent, task: string) => (await a.get(`/api/tasks/${task}`)).body;
const pipe = async (a: Agent, id: string) => (await a.get(`/api/pipes/${id}`)).body;

beforeAll(async () => {
  app = await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  const bobId = (await bob.get("/api/me")).body.user.id;
  team = (await alice.post("/api/spaces", { name: "Sprints", members: [{ userId: bobId }] })).body.id;
  board = (await alice.post(`/api/spaces/${team}/pipes`, { name: "App", kind: "sprint", visibility: "open" })).body.id;
  other = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Other app", kind: "sprint" })).body.id;
  general = (await alice.post(`/api/spaces/${team}/pipes`, { name: "General" })).body.id;
});

afterAll(stopApp);

describe("settings of a pipe in sprints", () => {
  it("have defaults, change for members, and exist only for types in sprints", async () => {
    expect((await pipe(alice, board)).sprintSettings).toMatchObject({ weeks: 2, startDay: 1, workDays: [1, 2, 3, 4, 5], velocityMode: "learned" });
    expect((await pipe(alice, board)).sprints).toEqual([]);
    expect((await bob.patch(`/api/pipes/${board}`, { sprintSettings: { weeks: 1, initialVelocity: 20 } })).status).toBe(200);
    expect((await pipe(alice, board)).sprintSettings).toMatchObject({ weeks: 1, initialVelocity: 20, startDay: 1 });
    expect((await alice.patch(`/api/pipes/${board}`, { sprintSettings: { weeks: 6 } })).body.error).toBe("A sprint lasts 1 to 4 weeks");
    const g = await pipe(alice, general);
    expect([g.sprintSettings, g.sprints]).toEqual([null, null]);
  });
});

describe("a sprint", () => {
  let s1: string, s2: string, a: string, b: string, c: string, d: string;

  it("is planned by members after the last one, with its name and dates", async () => {
    const res = await alice.post(`/api/pipes/${board}/sprints`, { goal: "Sign-in" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ number: 1, name: "Sprint 1", goal: "Sign-in", status: "planned" });
    s1 = res.body.id;
    // One week (the settings above): the next one follows.
    const next = (await bob.post(`/api/pipes/${board}/sprints`, {})).body;
    expect(next).toMatchObject({ number: 2, name: "Sprint 2" });
    expect(next.startsOn > res.body.endsOn).toBe(true);
    s2 = next.id;
    expect((await alice.post(`/api/pipes/${general}/sprints`, {})).body.error).toBe("This pipe does not work in sprints");
    // Carol sees the open pipe but is not a member.
    expect((await carol.post(`/api/pipes/${board}/sprints`, {})).status).toBe(403);
    expect((await carol.patch(`/api/sprints/${s1}`, { name: "Mine" })).status).toBe(403);
    expect((await alice.patch(`/api/sprints/${s1}`, { endsOn: "2020-01-01" })).body.error).toBe("A sprint ends after it starts");
    expect((await pipe(carol, board)).sprints.map((x: { name: string }) => x.name)).toEqual(["Sprint 2", "Sprint 1"]);
    expect((await carol.get(`/api/pipes/${board}/sprints`)).body).toHaveLength(2);
    expect((await alice.get(`/api/pipes/${general}/sprints`)).body).toEqual([]);
  });

  it("takes tasks of its pipe, noted in their history", async () => {
    a = await newTask(alice, { title: "Magic link", pipeId: board, points: 5, sprintId: s1 });
    b = await newTask(alice, { title: "Profile", pipeId: board, points: 8 });
    c = await newTask(alice, { title: "Crash", pipeId: board, points: 3 });
    d = await newTask(alice, { title: "Dropped idea", pipeId: board, points: 13, sprintId: s1 });
    expect((await get(alice, a)).sprintId).toBe(s1);
    expect((await bob.patch(`/api/tasks/${b}`, { sprintId: s1 })).status).toBe(200);
    expect((await get(alice, b)).events.at(-1)).toMatchObject({ details: { sprint: { from: null, to: { id: s1, name: "Sprint 1" } } } });
    expect((await alice.patch(`/api/tasks/${c}`, { sprintId: s1 })).status).toBe(200);
    // Another pipe's sprint, a task of a pipe without sprints, someone who cannot plan.
    const elsewhere = (await alice.post(`/api/pipes/${other}/sprints`, {})).body.id;
    expect((await alice.patch(`/api/tasks/${a}`, { sprintId: elsewhere })).body.error).toBe("Sprint not found");
    const g = await newTask(alice, { title: "Plain", pipeId: general });
    expect((await alice.patch(`/api/tasks/${g}`, { sprintId: s1 })).body.error).toBe("This pipe does not work in sprints");
    expect((await carol.patch(`/api/tasks/${a}`, { sprintId: null })).status).toBe(403);
  });

  it("starts alone, committing its points", async () => {
    await alice.patch(`/api/tasks/${d}`, { status: "abandoned" });
    const started = (await alice.post(`/api/sprints/${s1}/start`)).body;
    expect(started).toMatchObject({ status: "active", committedPoints: 16 });
    expect((await alice.post(`/api/sprints/${s2}/start`)).body.error).toBe("“Sprint 1” is under way: close it first");
    expect((await alice.post(`/api/sprints/${s1}/start`)).body.error).toBe("Only a planned sprint can start");
    expect((await alice.del(`/api/sprints/${s1}`)).body.error).toBe("Only a planned sprint can be deleted");
  });

  it("closes, keeping its points done and moving its unfinished tasks to the next sprint", async () => {
    await alice.patch(`/api/tasks/${a}`, { status: "done" });
    const closed = (await alice.post(`/api/sprints/${s1}/close`, { unfinished: "next" })).body;
    expect(closed).toMatchObject({
      status: "closed", completedPoints: 5,
      report: { committed: 16, completed: 5, done: 1, carried: 2, carriedPoints: 11, abandoned: 1, carriedTo: { id: s2, name: "Sprint 2" } },
    });
    expect([(await get(alice, b)).sprintId, (await get(alice, c)).sprintId, (await get(alice, a)).sprintId, (await get(alice, d)).sprintId])
      .toEqual([s2, s2, s1, s1]);
    expect((await get(alice, b)).events.at(-1)).toMatchObject({ details: { sprint: { from: { name: "Sprint 1" }, to: { name: "Sprint 2" } } } });
    expect((await alice.patch(`/api/tasks/${b}`, { sprintId: s1 })).body.error).toBe("A closed sprint takes no more tasks");
    expect((await alice.patch(`/api/sprints/${s1}`, { startsOn: "2026-01-01" })).body.error).toBe("The dates of a closed sprint cannot change");
    expect((await alice.patch(`/api/sprints/${s1}`, { exceptional: true })).body.exceptional).toBe(true);
    // Its report, frozen: scope, burndown, what was done per owner and type, and the velocity it leads to.
    expect(closed.report).toMatchObject({
      scopeStart: expect.any(Number), scopeEnd: expect.any(Number),
      byType: expect.arrayContaining([expect.objectContaining({ key: "task", done: 1, donePoints: 5 })]),
      velocity: { value: 20, source: "initial" },
    });
    expect(closed.report.burndown[0]).toMatchObject({ day: null, remaining: expect.any(Number) });
    expect((await carol.get(`/api/sprints/${s1}/burndown`)).body).toEqual(closed.report.burndown);
    expect((await alice.get(`/api/sprints/${s2}/burndown`)).status).toBe(200);
  });

  it("closed, sends its unfinished tasks to a new sprint, or to the backlog", async () => {
    await alice.post(`/api/sprints/${s2}/start`);
    const closed = (await alice.post(`/api/sprints/${s2}/close`)).body;
    expect(closed.report.carriedTo).toMatchObject({ name: "Sprint 3" });
    const s3 = closed.report.carriedTo.id;
    await alice.post(`/api/sprints/${s3}/start`);
    expect((await alice.post(`/api/sprints/${s3}/close`, { unfinished: "backlog" })).body.report).toMatchObject({ carried: 2, carriedTo: null });
    expect((await get(alice, b)).sprintId).toBeNull();
  });

  it("gives the pipe's velocity and the progress of its work", async () => {
    // Three closed sprints, the first left out: still too few to learn from, the initial velocity is used.
    expect((await pipe(alice, board)).velocity).toMatchObject({ value: 20, source: "initial" });
    const progress = (await carol.get(`/api/pipes/${board}/sprint-progress`)).body;
    expect(progress.velocity.samples.map((x: { excluded: string | null }) => x.excluded)).toEqual([null, null, "exceptional"]);
    // Its start counts once it has come (these sprints start next Monday).
    expect(progress.rows.filter((r: { name: string | null }) => r.name).map((r: { name: string }) => r.name)).toEqual(["Sprint 1", "Sprint 2", "Sprint 3"]);
    expect(progress).toMatchObject({ remaining: 11, unestimated: 0, projection: { sprintsLeft: 1 } });
    expect((await alice.get(`/api/pipes/${general}/sprint-progress`)).body.error).toBe("This pipe does not work in sprints");
  });

  it("planned, is deleted with its tasks back to the backlog; a task leaving the pipe leaves its sprint", async () => {
    const s = (await alice.post(`/api/pipes/${board}/sprints`, {})).body.id;
    await alice.patch(`/api/tasks/${b}`, { sprintId: s });
    expect((await alice.del(`/api/sprints/${s}`)).status).toBe(200);
    expect((await get(alice, b)).sprintId).toBeNull();
    const s5 = (await alice.post(`/api/pipes/${board}/sprints`, {})).body.id;
    await alice.patch(`/api/tasks/${c}`, { sprintId: s5 });
    expect((await alice.post(`/api/tasks/${c}/move`, { pipeId: general })).status).toBe(200);
    expect((await get(alice, c)).sprintId).toBeNull();
    expect((await get(alice, c)).events.at(-1)).toMatchObject({ type: "moved", details: { sprint: { from: { id: s5 }, to: null } } });
  });
});
