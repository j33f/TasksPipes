import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";
import { runRecurrences } from "../../src/recurrence.js";
import { recordOccurrence } from "../../src/routes.js";

let alice: Agent, carol: Agent, aliceSpace: string, pipe: string;

const at = (day: string) => new Date(`${day}T08:00:00Z`);
const run = (day: string) => runRecurrences(recordOccurrence, at(day));
const occurrences = async (recurrenceId: string) =>
  (await pool.query(`SELECT id, title, due_date, occurrence_on, stage, status FROM tasks WHERE recurrence_id = $1 ORDER BY occurrence_on`, [recurrenceId])).rows;
const repeat = async (task: string, body: Record<string, unknown>) => {
  const res = await alice.put(`/api/tasks/${task}/recurrence`, body);
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body;
};

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  carol = await signIn("carol-token");
  aliceSpace = (await alice.get("/api/me")).body.personalSpaceId;
  pipe = (await alice.post(`/api/spaces/${aliceSpace}/pipes`, { name: "Recurring", visibility: "open" })).body.id;
});
afterAll(stopApp);

describe("recurring tasks", () => {
  it("copy the latest occurrence on each date, once", async () => {
    const sales = (await alice.post(`/api/spaces/${aliceSpace}/pipes`, { name: "Billing", kind: "commercial" })).body.id;
    const task = (await alice.post("/api/tasks", {
      title: "Monthly invoice", description: "Send it", pipeId: sales, taskType: "opportunite", fields: { financement: "OPCO" },
      dueDate: "2026-11-02", items: [{ text: "Check hours", done: true }, "Send"],
    })).body.id;
    // The first Monday of each month.
    const r = await repeat(task, { rule: { freq: "monthly", monthly: { kind: "weekday", nth: 1, weekday: 1 } } });
    expect(r).toMatchObject({ startsOn: "2026-11-02", nextOn: "2026-12-07", upcoming: ["2026-12-07", "2027-01-04", "2027-02-01"] });
    expect((await alice.get(`/api/tasks/${task}`)).body.recurrence).toMatchObject({ mode: "schedule", leadDays: 0 });

    expect(await run("2026-12-06")).toBe(0);
    expect(await run("2026-12-07")).toBe(1);
    expect(await run("2026-12-07")).toBe(0);
    const [, second] = await occurrences(r.id);
    expect(second).toMatchObject({ title: "Monthly invoice", due_date: "2026-12-07", occurrence_on: "2026-12-07" });
    const copy = (await alice.get(`/api/tasks/${second.id}`)).body;
    expect(copy).toMatchObject({ description: "Send it", taskType: "opportunite", fields: { financement: "OPCO" } });
    expect(copy.items.map((i: { text: string; done: boolean }) => [i.text, i.done])).toEqual([["Check hours", false], ["Send", false]]);
    expect(copy.events[0]).toMatchObject({ type: "created" });
    expect(copy.recurrence.nextOn).toBe("2027-01-04");
  });

  it("are never made twice, even by passes running together", async () => {
    const task = (await alice.post("/api/tasks", { title: "Daily standup", pipeId: pipe, dueDate: "2026-10-20" })).body.id;
    const r = await repeat(task, { rule: { freq: "daily" } });
    const made = await Promise.all([run("2026-10-21"), run("2026-10-21"), run("2026-10-21")]);
    expect(made.reduce((a, b) => a + b, 0)).toBe(1);
    expect((await occurrences(r.id)).map((t) => t.occurrence_on)).toEqual(["2026-10-20", "2026-10-21"]);
  });

  it("are made ahead when asked", async () => {
    const task = (await alice.post("/api/tasks", { title: "Weekly report", pipeId: pipe, dueDate: "2026-10-23" })).body.id;
    const r = await repeat(task, { rule: { freq: "weekly", weekdays: [5] }, leadDays: 3 });
    // Passes make every series' tasks: count this one's.
    await run("2026-10-26");
    expect(await occurrences(r.id)).toHaveLength(1);
    await run("2026-10-27");
    expect((await occurrences(r.id)).map((t) => t.due_date)).toEqual(["2026-10-23", "2026-10-30"]);
  });

  it("skip the dates missed while the app was off, but the latest", async () => {
    const task = (await alice.post("/api/tasks", { title: "Backup check", pipeId: pipe, dueDate: "2026-10-01" })).body.id;
    const r = await repeat(task, { rule: { freq: "weekly", weekdays: [4] } });
    await run("2026-11-20");
    expect((await occurrences(r.id)).map((t) => t.occurrence_on)).toEqual(["2026-10-01", "2026-11-19"]);
    expect((await alice.get(`/api/tasks/${task}`)).body.recurrence.nextOn).toBe("2026-11-26");
  });

  it("can wait for the previous one to be done", async () => {
    const task = (await alice.post("/api/tasks", { title: "Water the plants", pipeId: pipe, dueDate: "2026-10-19" })).body.id;
    const r = await repeat(task, { rule: { freq: "weekly", weekdays: [1] }, mode: "after_done" });
    await run("2026-11-10");
    expect(await occurrences(r.id)).toHaveLength(1);
    await alice.patch(`/api/tasks/${task}`, { stage: "done" });
    // Done late: the next date is the first one still to come.
    await run("2026-11-10");
    expect((await occurrences(r.id)).at(-1)).toMatchObject({ occurrence_on: "2026-11-16", status: "backlog" });
    await run("2026-11-17");
    expect(await occurrences(r.id)).toHaveLength(2);
  });

  it("stop at their end date, or when stopped", async () => {
    const task = (await alice.post("/api/tasks", { title: "Short series", pipeId: pipe, dueDate: "2026-10-19" })).body.id;
    const r = await repeat(task, { rule: { freq: "daily" }, endsOn: "2026-10-20" });
    await run("2026-10-20");
    await run("2026-10-21");
    expect((await occurrences(r.id)).map((t) => t.occurrence_on)).toEqual(["2026-10-19", "2026-10-20"]);
    expect((await alice.get(`/api/tasks/${task}`)).body.recurrence).toMatchObject({ nextOn: null, upcoming: [] });

    const other = (await alice.post("/api/tasks", { title: "Stopped", pipeId: pipe, dueDate: "2026-10-19" })).body.id;
    const s = await repeat(other, { rule: { freq: "daily" } });
    expect((await alice.del(`/api/tasks/${other}/recurrence`)).status).toBe(200);
    await run("2026-10-25");
    expect(await occurrences(s.id)).toHaveLength(1);
  });

  it("stop once their pipe is archived", async () => {
    const old = (await alice.post(`/api/spaces/${aliceSpace}/pipes`, { name: "Ending" })).body.id;
    const task = (await alice.post("/api/tasks", { title: "In an old pipe", pipeId: old, dueDate: "2026-10-19" })).body.id;
    const r = await repeat(task, { rule: { freq: "daily" } });
    await alice.patch(`/api/tasks/${task}`, { stage: "done" });
    expect((await alice.patch(`/api/pipes/${old}`, { archived: true })).status).toBe(200);
    await run("2026-10-20");
    expect(await occurrences(r.id)).toHaveLength(1);
    expect((await pool.query(`SELECT active FROM task_recurrences WHERE id = $1`, [r.id])).rows[0].active).toBe(false);
  });

  it("are set by those who manage the task, on tasks in a pipe", async () => {
    const task = (await alice.post("/api/tasks", { title: "Alice's", pipeId: pipe })).body.id;
    // Carol sees the open pipe but does not manage its tasks.
    const res = await carol.put(`/api/tasks/${task}/recurrence`, { rule: { freq: "daily" } });
    expect(res.status).toBe(403);
    const mine = (await alice.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
    const hidden = (await alice.post("/api/tasks", { title: "Hidden", pipeId: mine })).body.id;
    expect((await carol.put(`/api/tasks/${hidden}/recurrence`, { rule: { freq: "daily" } })).status).toBe(404);
    const carolSpace = (await carol.get("/api/me")).body.personalSpaceId;
    const sent = (await alice.post("/api/tasks", { title: "Sent", spaceId: carolSpace })).body.id;
    expect((await carol.put(`/api/tasks/${sent}/recurrence`, { rule: { freq: "daily" } })).body.error).toBe("Only a task in a pipe can repeat");
    expect((await alice.put(`/api/tasks/${task}/recurrence`, { rule: { freq: "weekly", weekdays: [] } })).body.error).toBe("Choose at least one day of the week");
    expect((await alice.put(`/api/tasks/${task}/recurrence`, { rule: { freq: "daily" }, leadDays: 200 })).status).toBe(400);
  });
});
