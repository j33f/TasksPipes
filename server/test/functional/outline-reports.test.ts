import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { config } from "../../src/config.js";
import { pool } from "../../src/db.js";
import { runScheduledOutlineExports } from "../../src/outline-reports.js";
import { addDays, dailyPeriod, lastWeekday, localDay } from "../../src/time.js";

let alice: Agent, bob: Agent, carol: Agent, team: string, pipe: string, board: string;
// The report day whose period holds "now" (tests use UTC and 18:00).
const now = new Date();
const today = localDay(now, "UTC");
const day = now >= dailyPeriod(today, 18, "UTC").end ? addDays(today, 1) : today;

/** A document of the fake Outline, with its text and parent. */
const outlineDoc = async (id: string) => {
  const res = await fetch(`${config.outlineApiUrl}/api/documents.info`, {
    method: "POST", headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" }, body: JSON.stringify({ id }),
  });
  return ((await res.json()) as { data: { title: string; text: string; parentDocumentId: string | null; createdBy: string } }).data;
};
/** The document last published by a pipe by itself. */
const lastPublished = async (pipeId: string) => {
  let url: string | null = null;
  // Sprints are published in the background, after the answer.
  for (let i = 0; i < 50 && !url; i++) {
    url = (await alice.get(`/api/pipes/${pipeId}/outline-export`)).body.lastExportUrl;
    if (!url) await new Promise((r) => setTimeout(r, 50));
  }
  return outlineDoc(`doc-${url!.match(/new-(\d+)$/)![1]}`);
};

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  const bobId = (await bob.get("/api/me")).body.user.id;
  team = (await alice.post("/api/spaces", { name: "Reports to Outline", members: [{ userId: bobId }] })).body.id;
  pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Site [v2]", kind: "dev", visibility: "open" })).body.id;
  board = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Sprint board", kind: "sprint" })).body.id;
  const started = (await alice.post("/api/tasks", { title: "Started *today*", pipeId: pipe })).body.id;
  await alice.patch(`/api/tasks/${started}`, { stage: "en_cours" });
});
afterAll(stopApp);

describe("A daily report exported to Outline by hand", () => {
  it("becomes a document under the parent one picks, written as the person", async () => {
    const res = await bob.post(`/api/pipes/${pipe}/reports/daily/outline`, { date: day, parentDocumentId: "doc-1" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: expect.stringMatching(/^doc-/), url: expect.stringMatching(/^http:\/\/localhost:\d+\/doc\/new-/) });
    expect(res.body.title).toMatch(/^Activity of Site \[v2\] — /);
    const doc = await outlineDoc(res.body.id);
    expect(doc).toMatchObject({ parentDocumentId: "doc-1", createdBy: "Bob Durand" });
    // Task titles are escaped, and link back to the app.
    expect(doc.text).toContain("## Tasks started (1)");
    expect(doc.text).toMatch(/- \[TP-\d+\]\(http.*\/\?task=[\w-]+\) Started \\\*today\\\*/);
    expect(doc.text).toContain(`/pipes/${pipe})`);
  });

  it("takes a document's address as parent, and needs one when the pipe has none", async () => {
    const res = await alice.post(`/api/pipes/${pipe}/reports/daily/outline`, { date: day, parentDocumentId: "https://outline.test/doc/guide-onboarding-def456" });
    expect(res.status).toBe(200);
    expect((await outlineDoc(res.body.id)).parentDocumentId).toBe("doc-2");
    expect((await alice.post(`/api/pipes/${pipe}/reports/daily/outline`, { date: day })).body.error).toBe("Choose the parent document in Outline");
    expect((await alice.post(`/api/pipes/${pipe}/reports/daily/outline`, { parentDocumentId: "doc 1; drop" })).body.error).toBe("Choose the parent document in Outline");
  });

  it("is out of reach of people who cannot see the pipe", async () => {
    const hidden = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Hidden", kind: "dev" })).body.id;
    expect((await carol.post(`/api/pipes/${hidden}/reports/daily/outline`, { parentDocumentId: "doc-1" })).status).toBe(404);
  });
});

describe("Automatic publishing of a pipe's reports", () => {
  it("is set up by members, with an API key Outline accepts and a parent it knows", async () => {
    expect((await alice.get(`/api/pipes/${pipe}/outline-export`)).body).toBeNull();
    // Carol sees the open pipe, but is not a member.
    expect((await carol.put(`/api/pipes/${pipe}/outline-export`, { apiKey: "erin-token", parentDocumentId: "doc-1" })).status).toBe(403);
    expect((await alice.put(`/api/pipes/${pipe}/outline-export`, { parentDocumentId: "doc-1" })).body.error).toBe("An Outline API key is required");
    expect((await alice.put(`/api/pipes/${pipe}/outline-export`, { apiKey: "wrong", parentDocumentId: "doc-1" })).body.error)
      .toMatch(/^Outline refused this key or this document/);
    expect((await alice.put(`/api/pipes/${pipe}/outline-export`, { apiKey: "erin-token", parentDocumentId: "doc-404" })).body.error)
      .toMatch(/^Outline refused this key or this document/);
    const res = await alice.put(`/api/pipes/${pipe}/outline-export`, { apiKey: "erin-token", parentDocumentId: "doc-2", daily: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      parentDocId: "doc-2", parentDocTitle: "Guide d'onboarding", outlineUser: "Erin Moreau", daily: true, sprints: false,
      setBy: "Alice Martin", keyRefused: false, lastError: null,
    });
    // The key is never given back, and is stored encrypted.
    expect(JSON.stringify(res.body)).not.toContain("erin-token");
    const stored = await pool.query(`SELECT api_key FROM pipe_outline_exports WHERE pipe_id = $1`, [pipe]);
    expect(stored.rows[0].api_key).not.toContain("erin-token");
  });

  it("keeps the key when other settings change, and gives its parent to exports by hand", async () => {
    const res = await bob.put(`/api/pipes/${pipe}/outline-export`, { sprints: true });
    expect(res.body).toMatchObject({ daily: true, sprints: true, parentDocId: "doc-2", setBy: "Alice Martin" });
    const manual = await bob.post(`/api/pipes/${pipe}/reports/daily/outline`, { date: day });
    expect(await outlineDoc(manual.body.id)).toMatchObject({ parentDocumentId: "doc-2", createdBy: "Bob Durand" });
  });

  it("lets only the person who gave the key point it at other documents", async () => {
    const settings = `/api/pipes/${pipe}/outline-export`;
    const own = "Give your own Outline API key to change where this pipe publishes";
    // The form saved as it is (same parent, by id or by address), the key kept.
    expect((await bob.put(settings, { parentDocumentId: "doc-2", daily: true })).status).toBe(200);
    expect((await bob.put(settings, { parentDocumentId: "https://outline.test/doc/guide-onboarding-def456" })).status).toBe(200);
    // Elsewhere, or under another weekly parent: his own key.
    expect((await bob.put(settings, { parentDocumentId: "doc-1" })).body.error).toBe(own);
    expect((await bob.put(settings, { parentDocumentId: "doc-404" })).body.error).toBe(own);
    expect((await bob.put(settings, { weeklyParentDocumentId: "doc-1" })).body.error).toBe(own);
    expect((await bob.get(settings)).body).toMatchObject({ parentDocId: "doc-2", weeklyParentDocId: null, mine: false });
    // With it, the key and the e-mails are his.
    expect((await bob.put(settings, { apiKey: "bob-token", parentDocumentId: "doc-1" })).body)
      .toMatchObject({ parentDocId: "doc-1", setBy: "Bob Durand", outlineUser: "Bob Durand", mine: true });
    expect((await alice.get(settings)).body.mine).toBe(false);
    // Alice moves her own key freely.
    expect((await alice.put(settings, { apiKey: "erin-token", parentDocumentId: "doc-1" })).body.mine).toBe(true);
    expect((await alice.put(settings, { parentDocumentId: "doc-2" })).body).toMatchObject({ parentDocId: "doc-2", setBy: "Alice Martin" });
  });

  it("publishes the daily activity once, after the report hour, with the pipe's key", async () => {
    const end = dailyPeriod(day, 18, "UTC").end;
    expect((await runScheduledOutlineExports(new Date(end.getTime() - 60_000))).published).toBe(0);
    expect((await runScheduledOutlineExports(new Date(end.getTime() + 60_000))).published).toBe(1);
    expect((await runScheduledOutlineExports(new Date(end.getTime() + 120_000))).published).toBe(0);
    expect(await lastPublished(pipe)).toMatchObject({ parentDocumentId: "doc-2", createdBy: "Erin Moreau" });
  });

  it("publishes each sprint as it closes, and a closed sprint by hand", async () => {
    await alice.put(`/api/pipes/${board}/outline-export`, { apiKey: "erin-token", parentDocumentId: "doc-1", sprints: true });
    const s = (await alice.post(`/api/pipes/${board}/sprints`, { goal: "Sign-in" })).body.id;
    expect((await alice.post(`/api/sprints/${s}/report/outline`, { parentDocumentId: "doc-1" })).body.error).toBe("Only a closed sprint has a report");
    expect((await alice.post(`/api/sprints/${s}/start`)).status).toBe(200);
    expect((await alice.post(`/api/sprints/${s}/close`, { unfinished: "backlog" })).status).toBe(200);
    const doc = await lastPublished(board);
    expect(doc).toMatchObject({ title: "Sprint 1 of Sprint board — report", parentDocumentId: "doc-1", createdBy: "Erin Moreau" });
    expect(doc.text).toContain("## Sprint goal\n\nSign-in");
    expect(doc.text).toContain("| Committed | 0 pts |");
    const manual = await bob.post(`/api/sprints/${s}/report/outline`, {});
    expect(manual.status).toBe(200);
    expect(await outlineDoc(manual.body.id)).toMatchObject({ parentDocumentId: "doc-1", createdBy: "Bob Durand" });
    expect((await carol.post(`/api/sprints/${s}/report/outline`, { parentDocumentId: "doc-1" })).status).toBe(404);
  });

  it("stops when Outline refuses the key, until a new one is given", async () => {
    await fetch(`${config.outlineApiUrl}/test/revoke`, { method: "POST", body: JSON.stringify({ token: "erin-token" }) });
    const next = addDays(day, 1);
    const end = dailyPeriod(next, 18, "UTC").end;
    // Something to report on that day.
    await pool.query(
      `UPDATE task_events SET created_at = $2 WHERE task_id IN (SELECT id FROM tasks WHERE pipe_id = $1)`,
      [pipe, new Date(end.getTime() - 3600_000)]
    );
    expect(await runScheduledOutlineExports(new Date(end.getTime() + 60_000))).toMatchObject({ published: 0, failed: [{ pipeId: pipe }] });
    expect((await alice.get(`/api/pipes/${pipe}/outline-export`)).body).toMatchObject({ keyRefused: true, lastError: "Authentication required" });
    // A new key starts it again.
    const res = await alice.put(`/api/pipes/${pipe}/outline-export`, { apiKey: "alice-token" });
    expect(res.body).toMatchObject({ keyRefused: false, lastError: null, outlineUser: "Alice Martin" });
  });

  it("publishes the weekly time report on Fridays, under its own parent when one is set", async () => {
    const plain = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Plain" })).body.id;
    expect((await alice.post(`/api/pipes/${plain}/reports/weekly/outline`, { parentDocumentId: "doc-1" })).body.error).toBe("This pipe has no weekly time report");
    // The option is ignored on a pipe type without time reports.
    expect((await alice.put(`/api/pipes/${plain}/outline-export`, { apiKey: "alice-token", parentDocumentId: "doc-1", weekly: true, weeklyParentDocumentId: "doc-2" })).body)
      .toMatchObject({ weekly: false, weeklyParentDocId: null });
    const res = await alice.put(`/api/pipes/${pipe}/outline-export`, { weekly: true, weeklyParentDocumentId: "doc-1", daily: false });
    expect(res.body).toMatchObject({ weekly: true, weeklyParentDocId: "doc-1", weeklyParentDocTitle: "Roadmap 2027", parentDocId: "doc-2" });
    // By hand, from the weekly tab: under the weekly parent.
    const friday = lastWeekday(addDays(day, 6), 5);
    const manual = await bob.post(`/api/pipes/${pipe}/reports/weekly/outline`, { date: friday });
    expect(manual.status).toBe(200);
    expect(manual.body.title).toMatch(/^Time report of Site \[v2\] — week to /);
    expect(await outlineDoc(manual.body.id)).toMatchObject({ parentDocumentId: "doc-1", createdBy: "Bob Durand" });
    // Automatically, on Friday after the report hour, once; not on other days.
    const end = dailyPeriod(friday, 18, "UTC").end;
    await pool.query(`UPDATE task_events SET created_at = $2 WHERE task_id IN (SELECT id FROM tasks WHERE pipe_id = $1)`, [pipe, new Date(end.getTime() - 3 * 86400_000)]);
    const thursday = dailyPeriod(addDays(friday, -1), 18, "UTC").end;
    await pool.query(`DELETE FROM report_runs WHERE kind LIKE 'outline-weekly:%'`);
    const before = (await alice.get(`/api/pipes/${pipe}/outline-export`)).body.lastExportUrl;
    await runScheduledOutlineExports(new Date(thursday.getTime() + 60_000));
    expect((await alice.get(`/api/pipes/${pipe}/outline-export`)).body.lastExportUrl).toBe(before);
    await runScheduledOutlineExports(new Date(end.getTime() + 60_000));
    const doc = await lastPublished(pipe);
    expect(doc).toMatchObject({ parentDocumentId: "doc-1", createdBy: "Alice Martin" });
    expect(doc.title).toMatch(/^Time report of Site/);
    expect(doc.text).toContain("| Task type | In progress | Blocked | Tasks | Done |");
    const again = (await alice.get(`/api/pipes/${pipe}/outline-export`)).body.lastExportUrl;
    await runScheduledOutlineExports(new Date(end.getTime() + 120_000));
    expect((await alice.get(`/api/pipes/${pipe}/outline-export`)).body.lastExportUrl).toBe(again);
    // Cleared: back under the main parent.
    expect((await alice.put(`/api/pipes/${pipe}/outline-export`, { weeklyParentDocumentId: "" })).body.weeklyParentDocId).toBeNull();
  });

  it("is turned off by members", async () => {
    expect((await bob.del(`/api/pipes/${pipe}/outline-export`)).status).toBe(200);
    expect((await alice.get(`/api/pipes/${pipe}/outline-export`)).body).toBeNull();
  });
});

describe("When Outline fails for a passing reason", () => {
  let retried: string;
  const settings = () => alice.get(`/api/pipes/${retried}/outline-export`);
  const fail = (o: object) => fetch(`${config.outlineApiUrl}/test/fail`, { method: "POST", body: JSON.stringify(o) });
  /** Something to report on the day that ends at `end`. */
  const activityBefore = (end: Date) =>
    pool.query(`UPDATE task_events SET created_at = $2 WHERE task_id IN (SELECT id FROM tasks WHERE pipe_id = $1)`, [retried, new Date(end.getTime() - 3600_000)]);
  const published = async () => {
    const res = await fetch(`${config.outlineApiUrl}/api/documents.list`, {
      method: "POST", headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" }, body: JSON.stringify({ parentDocumentId: "doc-1" }),
    });
    return ((await res.json()) as { data: { title: string }[] }).data.filter((d) => d.title.startsWith("Activity of Retried"));
  };

  beforeAll(async () => {
    retried = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Retried", kind: "dev" })).body.id;
    const t = (await alice.post("/api/tasks", { title: "Something", pipeId: retried })).body.id;
    await alice.patch(`/api/tasks/${t}`, { stage: "en_cours" });
    await alice.put(`/api/pipes/${retried}/outline-export`, { apiKey: "frank-token", parentDocumentId: "doc-1", daily: true });
  });

  it("tries again ten minutes later, without a second document when Outline created the first one", async () => {
    const end = dailyPeriod(addDays(day, 10), 18, "UTC").end;
    const at = (minutes: number) => new Date(end.getTime() + minutes * 60_000);
    await activityBefore(end);
    await fail({ times: 1, status: 504, created: true });
    expect(await runScheduledOutlineExports(at(1))).toMatchObject({ published: 0, failed: [{ pipeId: retried, message: "Service unavailable" }] });
    expect((await settings()).body).toMatchObject({ lastError: "Service unavailable", keyRefused: false });
    expect(await published()).toHaveLength(1);
    // Not before ten minutes.
    expect(await runScheduledOutlineExports(at(5))).toMatchObject({ published: 0, failed: [] });
    expect((await runScheduledOutlineExports(at(12))).published).toBe(1);
    expect(await published()).toHaveLength(1);
    expect((await settings()).body).toMatchObject({ lastError: null, lastExportUrl: expect.stringMatching(/\/doc\//) });
    expect((await runScheduledOutlineExports(at(30))).published).toBe(0);
  });

  it("publishes once when two passes run at the same time", async () => {
    const end = dailyPeriod(addDays(day, 11), 18, "UTC").end;
    await activityBefore(end);
    const before = (await published()).length;
    const runs = await Promise.all([1, 2].map(() => runScheduledOutlineExports(new Date(end.getTime() + 60_000))));
    expect(runs[0].published + runs[1].published).toBe(1);
    expect(await published()).toHaveLength(before + 1);
  });

  it("stops trying when Outline then refuses the key", async () => {
    const end = dailyPeriod(addDays(day, 12), 18, "UTC").end;
    const at = (minutes: number) => new Date(end.getTime() + minutes * 60_000);
    await activityBefore(end);
    await fail({ times: 1, status: 503 });
    expect((await runScheduledOutlineExports(at(1))).failed).toHaveLength(1);
    await fetch(`${config.outlineApiUrl}/test/revoke`, { method: "POST", body: JSON.stringify({ token: "frank-token" }) });
    expect((await runScheduledOutlineExports(at(12))).failed).toHaveLength(1);
    expect((await settings()).body).toMatchObject({ keyRefused: true, lastError: "Authentication required" });
    expect(await runScheduledOutlineExports(at(30))).toMatchObject({ published: 0, failed: [] });
    const claims = await pool.query(`SELECT 1 FROM report_runs WHERE kind = $1 AND period_end = $2`, [`outline-daily:${retried}`, end]);
    expect(claims.rowCount).toBe(1);
  });
});
