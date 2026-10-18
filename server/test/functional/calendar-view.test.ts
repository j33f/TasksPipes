import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, signInWithLink, startApp, stopApp, type Agent } from "./helpers.js";

let alice: Agent, bob: Agent, carol: Agent, stranger: Agent, bobId: string, team: string, board: string, open: string;

const newTask = async (a: Agent, body: Record<string, unknown>) => (await a.post("/api/tasks", body)).body.id as string;
const calendar = async (a: Agent, q: string) => {
  const res = await a.get(`/api/calendar?${q}`);
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body.tasks as { id: string; title: string; dueDate: string; canMove: boolean }[];
};
const titles = (list: { title: string }[]) => list.map((t) => t.title).sort();
// A period no other test file uses.
const period = "from=2031-03-01&to=2031-03-31";

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  stranger = await signInWithLink((await bob.post("/api/invitations", { email: "calendar-stranger@example.com", name: "Stranger" })).body.link);
  bobId = (await bob.get("/api/me")).body.user.id;
  team = (await alice.post("/api/spaces", { name: "Calendar", members: [{ userId: bobId }] })).body.id;
  board = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Private board" })).body.id;
  open = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Open board", visibility: "open" })).body.id;
  await newTask(alice, { title: "Bob's review", pipeId: board, assigneeId: bobId, dueDate: "2031-03-10" });
  await newTask(alice, { title: "Team planning", pipeId: board, dueDate: "2031-03-12" });
  await newTask(alice, { title: "Open meetup", pipeId: open, dueDate: "2031-03-15" });
  await newTask(alice, { title: "Next month", pipeId: board, assigneeId: bobId, dueDate: "2031-04-02" });
  const done = await newTask(alice, { title: "Already done", pipeId: board, assigneeId: bobId, dueDate: "2031-03-11" });
  await alice.patch(`/api/tasks/${done}`, { status: "done" });
});
afterAll(stopApp);

describe("calendar", () => {
  it("shows one's own tasks due in the period, finished ones on demand", async () => {
    expect(titles(await calendar(bob, period))).toEqual(["Bob's review"]);
    expect(titles(await calendar(bob, `${period}&done=1`))).toEqual(["Already done", "Bob's review"]);
  });

  it("shows everything one sees on demand, by space too", async () => {
    expect(titles(await calendar(bob, `${period}&scope=all&space=${team}`))).toEqual(["Bob's review", "Open meetup", "Team planning"]);
  });

  it("shows nothing of pipes one cannot see", async () => {
    // Carol sees the open pipe only, and may not move its tasks.
    const carols = await calendar(carol, `${period}&scope=all&space=${team}`);
    expect(carols).toMatchObject([{ title: "Open meetup", canMove: false }]);
    expect((await carol.patch(`/api/tasks/${carols[0].id}`, { dueDate: "2031-03-16" })).status).toBe(403);
    expect(await calendar(stranger, `${period}&scope=all&space=${team}`)).toEqual([]);
    expect(titles(await calendar(bob, `${period}&scope=all&space=${team}`)).length).toBe(3);
  });

  it("lets members move due dates", async () => {
    const [mine] = await calendar(bob, period);
    expect(mine.canMove).toBe(true);
    expect((await bob.patch(`/api/tasks/${mine.id}`, { dueDate: "2031-03-20" })).status).toBe(200);
    expect((await calendar(bob, period))[0].dueDate).toBe("2031-03-20");
  });

  it("refuses periods that are wrong or too long", async () => {
    for (const q of ["from=2031-03-01", "from=2031-03-31&to=2031-03-01", "from=2031-01-01&to=2031-06-01", "from=yesterday&to=today"]) {
      expect((await bob.get(`/api/calendar?${q}`)).body.error, q).toBe("Invalid period");
    }
  });
});
