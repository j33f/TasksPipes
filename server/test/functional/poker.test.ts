import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

let alice: Agent, bob: Agent, carol: Agent;
let board: string, personal: string, dev: string;
let a: string, b: string, done: string;

const newTask = async (who: Agent, body: Record<string, unknown>) => (await who.post("/api/tasks", body)).body.id as string;
const get = async (who: Agent, task: string) => (await who.get(`/api/tasks/${task}`)).body;

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  const bobId = (await bob.get("/api/me")).body.user.id;
  const team = (await alice.post("/api/spaces", { name: "Poker", members: [{ userId: bobId }] })).body.id;
  board = (await alice.post(`/api/spaces/${team}/pipes`, { name: "App", kind: "sprint", visibility: "open" })).body.id;
  dev = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Dev", kind: "dev" })).body.id;
  const mine = (await alice.get("/api/me")).body.personalSpaceId;
  personal = (await alice.post(`/api/spaces/${mine}/pipes`, { name: "Solo sprints", kind: "sprint" })).body.id;
  a = await newTask(alice, { title: "Sign-in", pipeId: board });
  b = await newTask(alice, { title: "Profile", pipeId: board, points: 3 });
  done = await newTask(alice, { title: "Old", pipeId: board, stage: "termine" });
});

afterAll(stopApp);

describe("Planning Poker", () => {
  it("is on in team Sprint pipes, off in personal spaces and other types unless turned on", async () => {
    expect((await alice.get(`/api/pipes/${board}`)).body.poker).toEqual({ enabled: true, open: false });
    expect((await alice.get(`/api/pipes/${personal}`)).body.poker.enabled).toBe(false);
    expect((await alice.get(`/api/pipes/${dev}`)).body.poker.enabled).toBe(false);
    expect((await alice.patch(`/api/pipes/${dev}`, { poker: true })).status).toBe(200);
    expect((await alice.get(`/api/pipes/${dev}`)).body).toMatchObject({ pokerChoice: true, poker: { enabled: true, open: false } });
    expect((await alice.get(`/api/pipes/${dev}/poker`)).body).toEqual({ enabled: true, session: null });
    // Turned on in a personal space: still off (it takes a team).
    await alice.patch(`/api/pipes/${personal}`, { poker: true });
    expect((await alice.post(`/api/pipes/${personal}/poker`, { taskIds: [] })).body.error).toBe("Planning Poker is off in this pipe");
    // Carol sees the open pipe, but is not in the team.
    expect((await carol.get(`/api/pipes/${board}/poker`)).body).toEqual({ enabled: false, session: null });
    expect((await carol.post(`/api/pipes/${board}/poker`, { taskIds: [a] })).status).toBe(403);
  });

  it("estimates tasks together, each one's card hidden until shown", async () => {
    expect((await alice.post(`/api/pipes/${board}/poker`, { taskIds: [a, done] })).body.error).toBe("Only unfinished tasks of this pipe can be estimated");
    const opened = (await alice.post(`/api/pipes/${board}/poker`, { taskIds: [a, b] })).body;
    expect(opened).toMatchObject({ facilitatorId: expect.any(String), currentTaskId: a, round: 1, revealed: false });
    expect((await bob.post(`/api/pipes/${board}/poker`, { taskIds: [a] })).body.error).toBe("A session is already open in this pipe: join it");
    const id = opened.id;
    expect((await alice.get(`/api/pipes/${board}`)).body.poker.open).toBe(true);

    expect((await bob.post(`/api/poker/${id}/vote`, { value: "8" })).status).toBe(200);
    expect((await alice.post(`/api/poker/${id}/vote`, { value: "5" })).status).toBe(200);
    expect((await alice.post(`/api/poker/${id}/vote`, { value: "4" })).body.error).toBe("Invalid card");
    // Alice sees that Bob voted, not what; and her own card.
    const seen = (await alice.get(`/api/pipes/${board}/poker`)).body.session;
    const bobRow = seen.participants.find((x: { name: string }) => x.name === "Bob Durand");
    expect(bobRow).toMatchObject({ voted: true, vote: null });
    expect(seen.participants.find((x: { name: string }) => x.name === "Alice Martin")).toMatchObject({ vote: "5" });
    expect(seen.stats).toBeNull();
    expect(JSON.stringify(seen)).not.toContain('"8"');

    // Only the one who leads shows the cards.
    expect((await bob.post(`/api/poker/${id}/reveal`)).status).toBe(403);
    const shown = (await alice.post(`/api/poker/${id}/reveal`)).body;
    expect(shown.participants.find((x: { name: string }) => x.name === "Bob Durand").vote).toBe("8");
    expect(shown.stats).toMatchObject({ min: 5, max: 8, suggestion: 8, consensus: false });
    expect((await bob.post(`/api/poker/${id}/vote`, { value: "5" })).body.error).toBe("The cards are shown: wait for another round");

    // Another round, then the points: on the task, in its history, and the next task comes.
    expect((await alice.post(`/api/poker/${id}/round`)).body).toMatchObject({ round: 2, revealed: false });
    await bob.post(`/api/poker/${id}/vote`, { value: "5" });
    const next = (await alice.post(`/api/poker/${id}/estimate`, { points: 5 })).body;
    expect(next).toMatchObject({ currentTaskId: b, round: 1 });
    expect(next.tasks.find((x: { id: string }) => x.id === a)).toMatchObject({ points: 5, estimated: 5 });
    expect((await get(alice, a)).events.at(-1)).toMatchObject({ details: { points: { from: null, to: 5 }, poker: true } });
    expect((await alice.post(`/api/poker/${id}/estimate`, { points: 4 })).body.error).toBe("Invalid points");

    // Bob takes the lead, Alice no longer can; then the session closes.
    expect((await bob.post(`/api/poker/${id}/lead`)).status).toBe(200);
    expect((await alice.post(`/api/poker/${id}/current`, { taskId: a })).status).toBe(403);
    expect((await bob.post(`/api/poker/${id}/current`, { taskId: done })).body.error).toBe("This task is not in the session");
    expect((await bob.post(`/api/poker/${id}/close`)).status).toBe(200);
    expect((await alice.post(`/api/poker/${id}/vote`, { value: "3" })).body.error).toBe("This session is closed");
    expect((await alice.get(`/api/pipes/${board}/poker`)).body.session).toBeNull();
  });
});
