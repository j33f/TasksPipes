import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";
import { parseCsv } from "../../src/csv.js";
import { notificationState } from "../../src/notifications.js";

let app: FastifyInstance, alice: Agent, aliceFr: Agent, bob: Agent, carol: Agent;
let aliceSpace: string, sales: string, bobId: string;
let acmeStage: { id: string; label: string };

const download = async (a: Agent, pipe: string, query = "") => {
  const res = await app.inject({ method: "GET", url: `/api/pipes/${pipe}/export${query}`, headers: { cookie: a.cookie, "x-locale": a.lang } });
  return res;
};
const taskCount = async (pipe: string) => Number((await pool.query(`SELECT count(*) AS n FROM tasks WHERE pipe_id = $1`, [pipe])).rows[0].n);

beforeAll(async () => {
  app = await startApp();
  alice = await signIn("alice-token");
  aliceFr = await signIn("alice-token", "fr");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  bobId = (await bob.get("/api/me")).body.user.id;
  aliceSpace = (await alice.get("/api/me")).body.personalSpaceId;
  sales = (await alice.post(`/api/spaces/${aliceSpace}/pipes`, { name: "Sales 2026", kind: "commercial", visibility: "open" })).body.id;
  const id = (await alice.post("/api/tasks", {
    title: "ACME training", description: "Two sessions", pipeId: sales, taskType: "opportunite",
    fields: { financement: "OPCO", stagiaires: 12 }, dueDate: "2026-06-30", items: ["Quote", { text: "Call", done: true }],
  })).body.id;
  // Its second column, whatever the commercial type calls it.
  const second = (await alice.get("/api/catalog")).body.pipeTypes.find((t: { id: string }) => t.id === "commercial").columns[1];
  await alice.patch(`/api/tasks/${id}`, { stage: second.id });
  acmeStage = { id: second.id, label: second.label };
  await alice.post("/api/tasks", { title: "=HYPERLINK(\"http://evil\")", pipeId: sales });
});
afterAll(stopApp);

describe("pipe export", () => {
  it("gives a CSV file with one column per field, safe for spreadsheets", async () => {
    const res = await download(alice, sales);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="Sales-2026.csv"');
    const [head, ...rows] = parseCsv(res.body);
    expect(head.slice(0, 8)).toEqual(["Key", "Title", "Description", "Column", "Owner", "Due date", "Task type", "Sub-tasks"]);
    expect(head).toContain("Funding");
    const acme = rows.find((r) => r[1] === "ACME training")!;
    expect(acme[3]).toBe(acmeStage.label);
    expect(acme[4]).toBe("Alice Martin");
    expect(acme[5]).toBe("2026-06-30");
    expect(acme[7]).toBe("[ ] Quote\n[x] Call");
    expect(acme[head.indexOf("Funding")]).toBe("OPCO");
    // A formula is written as text.
    expect(rows.some((r) => r[1] === "'=HYPERLINK(\"http://evil\")")).toBe(true);
  });

  it("follows the language: French headers and semicolons", async () => {
    const [head] = parseCsv((await download(aliceFr, sales)).body);
    expect(head.slice(0, 4)).toEqual(["Clé", "Titre", "Description", "Colonne"]);
    expect((await download(aliceFr, sales)).body.split("\r\n")[0]).toContain(";");
  });

  it("gives JSON with the fields' values and labels", async () => {
    const res = await download(alice, sales, "?format=json");
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    const data = JSON.parse(res.body);
    const acme = data.tasks.find((t: { title: string }) => t.title === "ACME training");
    expect(acme).toMatchObject({ column: acmeStage.label, taskType: { id: "opportunite" }, subTasks: [{ text: "Quote", done: false }, { text: "Call", done: true }] });
    expect(acme.fields).toContainEqual(expect.objectContaining({ id: "financement", label: "Funding", value: "OPCO" }));
  });

  it("is open to whoever sees the pipe, and to no one else", async () => {
    // Carol sees Alice's open pipe; a private one stays unknown to her.
    expect((await download(carol, sales)).statusCode).toBe(200);
    const mine = (await alice.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
    expect((await download(carol, mine)).statusCode).toBe(404);
  });
});

describe("pipe import", () => {
  it("previews a CSV file: columns matched from the headers, first tasks, errors", async () => {
    const csv = (await download(alice, sales)).body;
    const target = (await alice.post(`/api/spaces/${aliceSpace}/pipes`, { name: "Sales copy", kind: "commercial" })).body.id;
    const preview = await alice.post(`/api/pipes/${target}/import/preview`, { content: csv });
    expect(preview.status).toBe(200);
    expect(preview.body.mapping.slice(0, 8)).toEqual(["ignore", "title", "description", "column", "owner", "dueDate", "taskType", "items"]);
    expect(preview.body.count).toBe(2);
    expect(preview.body.errorCount).toBe(0);
    expect(preview.body.tasks[0]).toMatchObject({ title: "ACME training", stage: acmeStage.id, owner: null });
    // Importing: the same tasks, fields and sub-tasks.
    const done = await alice.post(`/api/pipes/${target}/import`, { content: csv });
    expect(done.body).toEqual({ created: 2 });
    const board = (await alice.get(`/api/pipes/${target}`)).body.tasks;
    const acme = board.find((t: { title: string }) => t.title === "ACME training");
    expect(acme).toMatchObject({ stage: acmeStage.id, taskType: "opportunite", dueDate: "2026-06-30", fields: { financement: "OPCO", stagiaires: 12 } });
    expect(acme.checklist).toMatchObject({ total: 2, done: 1 });
    const history = (await alice.get(`/api/tasks/${acme.id}`)).body.events;
    expect(history[0]).toMatchObject({ type: "created" });
  });

  it("imports nothing when a line is wrong, and says which", async () => {
    const pipe = (await alice.post(`/api/spaces/${aliceSpace}/pipes`, { name: "Strict" })).body.id;
    const csv = "Title,Due date\nFine,2026-01-01\nWrong,31/02/2026\n,\nAlso fine,\n";
    const res = await alice.post(`/api/pipes/${pipe}/import`, { content: csv });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("1 lines cannot be imported: nothing was imported");
    expect(res.body.errors).toEqual([{ line: 3, message: "Invalid due date: 31/02/2026" }]);
    expect(await taskCount(pipe)).toBe(0);
  });

  it("takes owners among the team's members only, and e-mails nobody", async () => {
    const team = (await alice.post("/api/spaces", { name: "Import team", members: [{ userId: bobId }] })).body.id;
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Board" })).body.id;
    const refused = await alice.post(`/api/pipes/${pipe}/import`, { content: "Title,Owner\nFor Carol,Carol Petit\n" });
    expect(refused.body.errors).toEqual([{ line: 2, message: "Carol Petit is not a member of this space" }]);
    notificationState.enabled = true;
    try {
      expect((await alice.post(`/api/pipes/${pipe}/import`, { content: "Title;Owner\nFor Bob;bob@example.com\n" })).body).toEqual({ created: 1 });
    } finally {
      notificationState.enabled = false;
    }
    const task = (await alice.get(`/api/pipes/${pipe}`)).body.tasks[0];
    expect(task.assignee.name).toBe("Bob Durand");
    expect((await pool.query(`SELECT 1 FROM notifications WHERE task_id = $1`, [task.id])).rows).toEqual([]);
  });

  it("is for the space's members, in pipes still open", async () => {
    const res = await carol.post(`/api/pipes/${sales}/import/preview`, { content: "Title\nx\n" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Only the space's members can import tasks");
    const mine = (await alice.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
    expect((await carol.post(`/api/pipes/${mine}/import`, { content: "Title\nx\n" })).status).toBe(404);
    const old = (await alice.post(`/api/spaces/${aliceSpace}/pipes`, { name: "Old" })).body.id;
    await alice.patch(`/api/pipes/${old}`, { archived: true });
    expect((await alice.post(`/api/pipes/${old}/import`, { content: "Title\nx\n" })).body.error).toBe("This pipe is archived");
  });

  it("reads a Trello board, its lists placed in columns", async () => {
    const pipe = (await alice.post(`/api/spaces/${aliceSpace}/pipes`, { name: "From Trello" })).body.id;
    const board = JSON.stringify({
      lists: [{ id: "l1", name: "Doing" }],
      cards: [{ id: "c1", name: "Trello card", desc: "From the board", idList: "l1", due: null }],
      checklists: [{ id: "k", idCard: "c1", checkItems: [{ name: "Step", state: "complete" }] }],
      actions: [{ type: "commentCard", date: "2026-04-01T08:00:00Z", data: { text: "Nice", card: { id: "c1" } }, memberCreator: { fullName: "Tim" } }],
    });
    const preview = await alice.post(`/api/pipes/${pipe}/import/preview`, { source: "trello", content: board });
    expect(preview.body.columnValues).toEqual([{ value: "Doing", column: "" }]);
    const res = await alice.post(`/api/pipes/${pipe}/import`, { source: "trello", content: board, columnValues: { Doing: "ongoing" } });
    expect(res.body).toEqual({ created: 1 });
    const task = (await alice.get(`/api/pipes/${pipe}`)).body.tasks[0];
    expect(task).toMatchObject({ title: "Trello card", description: "From the board", stage: "ongoing" });
    const events = (await alice.get(`/api/tasks/${task.id}`)).body.events;
    expect(events.find((e: { type: string }) => e.type === "comment").comment).toBe("Tim on Trello, 2026-04-01:\n\nNice");
    expect((await alice.post(`/api/pipes/${pipe}/import/preview`, { source: "trello", content: "{nope" })).body.error)
      .toBe("This is not a Trello board exported as JSON");
  });
});
