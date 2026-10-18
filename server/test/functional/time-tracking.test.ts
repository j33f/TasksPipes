import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signIn, signInWithLink, startApp, stopApp, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";
import { addDays, localDay } from "../../src/time.js";
import { config } from "../../src/config.js";
import { pipeWeeklyReport } from "../../src/reports.js";

let app: FastifyInstance, alice: Agent, bob: Agent, carol: Agent, stranger: Agent;
let bobId: string, team: string, board: string, open: string, task: string;
const today = localDay(new Date(), config.timezone);

const log = (a: Agent, id: string, body: Record<string, unknown>) => a.post(`/api/tasks/${id}/time`, body);
const time = async (a: Agent, id: string) => (await a.get(`/api/tasks/${id}/time`)).body;

beforeAll(async () => {
  app = await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  stranger = await signInWithLink((await bob.post("/api/invitations", { email: "time-stranger@example.com", name: "Stranger" })).body.link);
  bobId = (await bob.get("/api/me")).body.user.id;
  // Alice is the team's admin, Bob a member.
  team = (await alice.post("/api/spaces", { name: "Time", members: [{ userId: bobId }] })).body.id;
  board = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Software", kind: "dev" })).body.id;
  open = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Open board", visibility: "open" })).body.id;
  task = (await alice.post("/api/tasks", { title: "Build it", pipeId: board, estimateMinutes: 120 })).body.id;
});
afterAll(stopApp);

describe("estimates and logged time", () => {
  it("log one's own time, add up against the estimate, shown on the card", async () => {
    expect((await log(bob, task, { minutes: 90, note: "Specs" })).body).toMatchObject({ minutes: 90, spentOn: today, mine: true, user: { name: "Bob Durand" } });
    expect((await log(alice, task, { minutes: 60, spentOn: addDays(today, -3) })).status).toBe(200);
    const t = await time(bob, task);
    expect(t.totalMinutes).toBe(150);
    expect(t.entries.map((e: { minutes: number; canDelete: boolean }) => [e.minutes, e.canDelete])).toEqual([[90, true], [60, false]]);
    const detail = (await alice.get(`/api/tasks/${task}`)).body;
    expect(detail).toMatchObject({ estimateMinutes: 120, loggedMinutes: 150 });
    const card = (await alice.get(`/api/pipes/${board}`)).body.tasks.find((x: { id: string }) => x.id === task);
    expect(card).toMatchObject({ estimateMinutes: 120, loggedMinutes: 150 });
  });

  it("change an estimate in the history, and refuse wrong values", async () => {
    expect((await bob.patch(`/api/tasks/${task}`, { estimateMinutes: 240 })).status).toBe(200);
    expect((await alice.get(`/api/tasks/${task}`)).body.events.at(-1)).toMatchObject({ details: { estimate: { from: 120, to: 240 } } });
    expect((await bob.patch(`/api/tasks/${task}`, { estimateMinutes: 0 })).body.error).toBe("Invalid estimate");
    expect((await log(bob, task, { minutes: 2000 })).body.error).toBe("Logged time is from 1 minute to 24 hours");
    expect((await log(bob, task, { minutes: 30, spentOn: addDays(today, 1) })).body.error).toBe("Log time for a day of the last {n} days".replace("{n}", "90"));
    expect((await log(bob, task, { minutes: 30, spentOn: addDays(today, -91) })).status).toBe(400);
  });

  it("are changed by their author only", async () => {
    const mine = (await log(bob, task, { minutes: 15 })).body.id;
    expect((await bob.patch(`/api/time/${mine}`, { minutes: 20, note: "Fixed" })).body).toMatchObject({ minutes: 20, note: "Fixed" });
    expect((await alice.patch(`/api/time/${mine}`, { minutes: 5 })).status).toBe(403);
    expect((await bob.del(`/api/time/${mine}`)).status).toBe(200);
  });

  it("are deleted by others only as an admin of the task's team, noted in its history", async () => {
    const bobs = (await log(bob, task, { minutes: 45 })).body.id;
    const alices = (await log(alice, task, { minutes: 10 })).body.id;
    // Bob is only a member.
    expect((await bob.del(`/api/time/${alices}`)).status).toBe(403);
    expect((await alice.del(`/api/time/${bobs}`)).status).toBe(200);
    expect((await alice.get(`/api/tasks/${task}`)).body.events.at(-1)).toMatchObject({
      type: "time", details: { timeRemoved: { minutes: 45, of: "Bob Durand" } },
    });
  });

  it("are logged by those who edit the task, seen by those who see it", async () => {
    // Carol sees the open board: she logs time on her own task there, only reads Alice's.
    const carols = (await carol.post("/api/tasks", { title: "Carol's", pipeId: open })).body.id;
    expect((await log(carol, carols, { minutes: 30 })).status).toBe(200);
    const alices = (await alice.post("/api/tasks", { title: "Alice's, open", pipeId: open })).body.id;
    await log(alice, alices, { minutes: 30 });
    expect((await log(carol, alices, { minutes: 30 })).status).toBe(403);
    expect((await time(carol, alices)).totalMinutes).toBe(30);
    // The private board is out of her sight.
    expect((await carol.get(`/api/tasks/${task}/time`)).status).toBe(404);
    expect((await log(carol, task, { minutes: 30 })).status).toBe(404);
    const entry = (await time(alice, task)).entries[0].id;
    for (const res of [await carol.patch(`/api/time/${entry}`, { minutes: 1 }), await carol.del(`/api/time/${entry}`), await stranger.del(`/api/time/${entry}`)]) {
      expect(res.status).toBe(404);
    }
  });

  it("count in the weekly report and the export", async () => {
    const report = await pipeWeeklyReport(board, addDays(today, 3));
    expect(report.logged?.totalMinutes).toBeGreaterThan(0);
    expect(report.logged?.tasks[0]).toMatchObject({ title: "Build it", estimateMinutes: 240 });
    const csv = (await app.inject({ method: "GET", url: `/api/pipes/${board}/export?sep=,`, headers: { cookie: alice.cookie } })).body;
    expect(csv).toContain("Estimate (hours),Logged time (hours)");
    expect(csv).toMatch(/Build it.*,4,\d/s);
  });

  it("stay on the task when their author's account is deleted (moved to its placeholder, as comments)", async () => {
    // The account deletion moves every reference without a cascade to the placeholder account (account.ts).
    const { rows } = await pool.query(
      `SELECT c.confdeltype FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.conrelid = 'task_time_entries'::regclass AND a.attname = 'user_id' AND c.contype = 'f'`
    );
    expect(rows[0].confdeltype).toBe("a");
  });
});
