import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, signIn, startApp, stopApp, type Agent } from "./helpers.js";

let alice: Agent;

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
});
afterAll(stopApp);

const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("calendar feed", () => {
  it("lists my tasks with a due date, with reminders on open ones", async () => {
    const pipe = (await alice.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
    await alice.post("/api/tasks", { title: "Jury, room; coffee", pipeId: pipe, dueDate: "2031-03-20" });
    await alice.post("/api/tasks", { title: "Done already", pipeId: pipe, dueDate: "2099-01-01", status: "done" });
    await alice.post("/api/tasks", { title: "No date", pipeId: pipe });

    const { url } = (await alice.get("/api/me/calendar")).body;
    expect((await alice.get("/api/me/calendar")).body.url).toBe(url);
    const path = new URL(url).pathname;
    const res = await agent().get(path);
    expect(res.status).toBe(200);
    const ics = unfold(res.body);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:Jury\\, room\\; coffee");
    expect(ics).toContain("DTSTART;VALUE=DATE:20310320");
    expect(ics).toContain("SUMMARY:✓ Done already");
    expect(ics).not.toContain("No date");
    // Other test files add tasks too: look at these two events only.
    const events = ics.split("BEGIN:VEVENT");
    const open = events.find((e) => e.includes("SUMMARY:Jury"))!;
    const done = events.find((e) => e.includes("SUMMARY:✓ Done already"))!;
    expect(open.match(/BEGIN:VALARM/g)).toHaveLength(3);
    expect(open).toContain("TRIGGER:-P4DT15H");
    expect(done).not.toContain("BEGIN:VALARM");
  });

  it("stops working once the link is renewed", async () => {
    const old = new URL((await alice.get("/api/me/calendar")).body.url).pathname;
    const renewed = new URL((await alice.post("/api/me/calendar/reset")).body.url).pathname;
    expect(renewed).not.toBe(old);
    expect((await agent().get(old)).status).toBe(404);
    expect((await agent().get(renewed)).status).toBe(200);
    expect((await agent().get("/cal/not-a-real-token-at-all.ics")).status).toBe(404);
  });
});
