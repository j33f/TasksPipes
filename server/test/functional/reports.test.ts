import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { runScheduledReports } from "../../src/reports.js";
import { addDays, dailyPeriod, lastWeekday, localDay } from "../../src/time.js";

let alice: Agent, bob: Agent, pipe: string, team: string;
// The report day whose period holds "now" (tests use UTC and 18:00).
const now = new Date();
const today = localDay(now, "UTC");
const day = now >= dailyPeriod(today, 18, "UTC").end ? addDays(today, 1) : today;

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  const bobId = (await bob.get("/api/me")).body.user.id;
  team = (await alice.post("/api/spaces", { name: "Product", members: [{ userId: bobId }] })).body.id;
  pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "App (reports)", kind: "dev" })).body.id;
});
afterAll(stopApp);

describe("time per step", () => {
  it("is given with each task", async () => {
    const id = (await alice.post("/api/tasks", { title: "Timed", pipeId: pipe })).body.id;
    await alice.patch(`/api/tasks/${id}`, { stage: "en_cours" });
    const { timing } = (await alice.get(`/api/tasks/${id}`)).body;
    expect(timing.steps.map((s: { label: string }) => s.label)).toEqual(["Backlog", "In progress"]);
    expect(timing).toMatchObject({ done: false, current: { label: "In progress" } });
    expect(timing.cycleMs).toBeGreaterThanOrEqual(0);
  });
});

describe("reports", () => {
  it("tell what happened in a pipe during a day", async () => {
    const started = (await alice.post("/api/tasks", { title: "Started today", pipeId: pipe, taskType: "bug" })).body.id;
    await alice.patch(`/api/tasks/${started}`, { stage: "en_cours" });
    const done = (await alice.post("/api/tasks", { title: "Done today", pipeId: pipe })).body.id;
    await alice.patch(`/api/tasks/${done}`, { stage: "termine" });
    const r = (await bob.get(`/api/pipes/${pipe}/reports/daily?date=${day}`)).body;
    expect(r).toMatchObject({ day, hour: 18, timezone: "UTC" });
    const titles = (list: { title: string }[]) => list.map((t) => t.title);
    expect(titles(r.started)).toContain("Started today");
    expect(titles(r.done)).toContain("Done today");
    expect(titles(r.inProgress)).toContain("Started today");
    expect(r.started[0].stage).toBeTruthy();
  });

  it("give the time spent per task type over a week, for development pipes", async () => {
    const friday = lastWeekday(addDays(day, 6), 5);
    const r = (await alice.get(`/api/pipes/${pipe}/reports/weekly?date=${friday}`)).body;
    expect(r.day).toBe(friday);
    expect(r.byType.map((x: { taskType: string }) => x.taskType)).toEqual(expect.arrayContaining(["bug", "task"]));
  });

  it("are not shown to people who cannot see the pipe", async () => {
    const carol = await signIn("carol-token");
    expect((await carol.get(`/api/pipes/${pipe}/reports/daily`)).status).toBe(404);
  });

  it("are sent by e-mail once, to the members, when the pipe asks for it", async () => {
    expect((await alice.patch(`/api/pipes/${pipe}`, { dailyReport: true, weeklyReport: true })).status).toBe(200);
    expect((await alice.get(`/api/pipes/${pipe}`)).body).toMatchObject({ dailyReport: true, weeklyReport: true });
    const sent: { to: string; subject: string; lang: string }[] = [];
    const send = async (lang: string, to: string, subject: string) => void sent.push({ to, subject, lang });
    const end = dailyPeriod(day, 18, "UTC").end;
    // Before the report hour: nothing.
    expect(await runScheduledReports(new Date(end.getTime() - 60_000), send)).toBe(0);
    await runScheduledReports(new Date(end.getTime() + 60_000), send);
    const daily = sent.filter((m) => m.subject.startsWith("Activity of App (reports)"));
    expect(daily.map((m) => m.to).sort()).toEqual(["alice@example.com", "bob@example.com"]);
    // Once only.
    sent.length = 0;
    await runScheduledReports(new Date(end.getTime() + 120_000), send);
    expect(sent.filter((m) => m.subject.startsWith("Activity of App (reports)"))).toEqual([]);
  });

  it("send the weekly time report on Fridays only, for pipes with time reports", async () => {
    const sent: string[] = [];
    const send = async (_l: string, _to: string, subject: string) => void sent.push(subject);
    const friday = lastWeekday(addDays(day, 6), 5);
    await runScheduledReports(new Date(dailyPeriod(friday, 18, "UTC").end.getTime() + 60_000), send);
    expect(sent.some((s) => s.startsWith("Time report of App (reports)"))).toBe(true);
    // The weekly option is ignored on a pipe type without time reports.
    const space = (await alice.get("/api/me")).body.personalSpaceId;
    const general = (await alice.post(`/api/spaces/${space}/pipes`, { name: "Plain" })).body.id;
    await alice.patch(`/api/pipes/${general}`, { weeklyReport: true });
    expect((await alice.get(`/api/pipes/${general}`)).body.weeklyReport).toBe(false);
  });
});
