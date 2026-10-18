import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, signInWithLink, startApp, stopApp, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";

let alice: Agent, bob: Agent, carol: Agent, hidden: Agent;
let aliceSpace: string, alicePipe: string, bobId: string;

interface Hit { id: string; key: string; title: string; column: string | null; snippet: string | null; confidential: boolean;
  space: { name: string }; pipe: { name: string; archived: boolean } | null; owner: { name: string } | null }
const search = async (a: Agent, q: string, filters = "") =>
  (await a.get(`/api/search?q=${encodeURIComponent(q)}${filters}`)).body as Hit[];
const ids = async (a: Agent, q: string, filters = "") => (await search(a, q, filters)).map((h) => h.id);
const create = async (a: Agent, body: Record<string, unknown>) => {
  const res = await a.post("/api/tasks", body);
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body.id as string;
};

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token", "fr");
  carol = await signIn("carol-token");
  // Someone invited by Bob: they see Bob, not Alice.
  hidden = await signInWithLink((await bob.post("/api/invitations", { email: "search-hidden@example.com", name: "Hidden" })).body.link);
  aliceSpace = (await alice.get("/api/me")).body.personalSpaceId;
  alicePipe = (await alice.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
  bobId = (await bob.get("/api/me")).body.user.id;
});
afterAll(stopApp);

describe("search", () => {
  it("finds a task by title, description, sub-task, field, comment and number", async () => {
    const sales = (await alice.post(`/api/spaces/${aliceSpace}/pipes`, { name: "Sales", kind: "commercial" })).body.id;
    const id = await create(alice, {
      title: "Quarterly kumquat review", description: "Bring the persimmon figures", pipeId: sales, taskType: "opportunite",
      fields: { financement: "OPCO" }, items: ["Book the tamarind room"],
    });
    await alice.post(`/api/tasks/${id}/comments`, { body: "The rambutan supplier called" });
    const number = (await alice.get(`/api/tasks/${id}`)).body.number;
    for (const q of ["kumquat", "persimmon", "tamarind", "opco", "rambutan", `TP-${number}`, `tp${number}`]) {
      expect(await ids(alice, q), q).toContain(id);
    }
    // Words are prefixes, and all of them must match.
    expect(await ids(alice, "kumq revi")).toContain(id);
    expect(await ids(alice, "kumquat lychee")).not.toContain(id);
  });

  it("ignores accents and follows the language of the person searching", async () => {
    const id = await create(alice, { title: "Inscriptions des élèves", pipeId: alicePipe });
    expect(await ids(alice, "eleves")).toContain(id);
    expect(await ids(alice, "ÉLÈVE")).toContain(id);
    // In French, "inscription" and "inscriptions" share a stem.
    const team = (await alice.post("/api/spaces", { name: "Search FR", members: [{ userId: bobId }] })).body.id;
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Board" })).body.id;
    const fr = await create(alice, { title: "Les inscriptions ouvrent", pipeId: pipe });
    expect(await ids(bob, "inscription")).toContain(fr);
  });

  it("follows edits: title, sub-tasks and comments", async () => {
    const id = await create(alice, { title: "Durian order", pipeId: alicePipe });
    await alice.patch(`/api/tasks/${id}`, { title: "Mangosteen order" });
    expect(await ids(alice, "durian")).not.toContain(id);
    expect(await ids(alice, "mangosteen")).toContain(id);
    const item = (await alice.post(`/api/tasks/${id}/items`, { text: "Call the jabuticaba farm" })).body.id;
    expect(await ids(alice, "jabuticaba")).toContain(id);
    await alice.del(`/api/items/${item}`);
    expect(await ids(alice, "jabuticaba")).not.toContain(id);
  });

  it("gives the path, owner and an excerpt with the matched words marked", async () => {
    const id = await create(alice, { title: "Path check", description: "Some words before the salak fruit and after", pipeId: alicePipe });
    await alice.patch(`/api/tasks/${id}`, { stage: "ongoing" });
    const hit = (await search(alice, "salak")).find((h) => h.id === id)!;
    expect(hit).toMatchObject({ title: "Path check", space: { name: "Alice Martin" }, pipe: { archived: false }, owner: { name: "Alice Martin" }, confidential: false });
    expect(hit.column).toBeTruthy();
    expect(hit.snippet).toContain("\u0002salak\u0003");
    // Found by its title only: no excerpt.
    expect((await search(alice, "path check")).find((h) => h.id === id)!.snippet).toBeNull();
  });

  it("filters by status, owner and task type", async () => {
    const team = (await alice.post("/api/spaces", { name: "Filters", members: [{ userId: bobId }] })).body.id;
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Board" })).body.id;
    const mine = await create(alice, { title: "Feijoa one", pipeId: pipe });
    const bobs = await create(alice, { title: "Feijoa two", pipeId: pipe, assigneeId: bobId });
    await alice.patch(`/api/tasks/${mine}`, { stage: "done" });
    expect(await ids(alice, "feijoa", "&status=open")).toEqual([bobs]);
    expect(await ids(alice, "feijoa", "&status=done")).toEqual([mine]);
    expect(await ids(alice, "feijoa", `&owner=${bobId}`)).toEqual([bobs]);
    expect(await ids(alice, "feijoa", "&type=opportunite")).toEqual([]);
    expect((await alice.get("/api/search?q=feijoa&status=lost")).status).toBe(400);
    expect((await alice.get("/api/search?q=feijoa&owner=nobody")).status).toBe(400);
  });

  it("marks tasks of archived pipes", async () => {
    const pipe = (await alice.post(`/api/spaces/${aliceSpace}/pipes`, { name: "Old" })).body.id;
    const id = await create(alice, { title: "Archived pitaya", pipeId: pipe });
    await alice.patch(`/api/tasks/${id}`, { stage: "done" });
    expect((await alice.patch(`/api/pipes/${pipe}`, { archived: true })).status).toBe(200);
    expect((await search(alice, "pitaya")).find((h) => h.id === id)!.pipe).toMatchObject({ name: "Old", archived: true });
  });

  it("finds nothing for a search without letters or digits", async () => {
    expect(await search(alice, " -!& ")).toEqual([]);
    expect(await search(alice, "':*|")).toEqual([]);
  });
});

describe("search access", () => {
  it("finds exactly the tasks one can open", async () => {
    const word = "zebracorn";
    const tasks: string[] = [];
    // Alice's private and open personal pipes.
    tasks.push(await create(alice, { title: `${word} private`, pipeId: alicePipe }));
    const open = (await alice.post(`/api/spaces/${aliceSpace}/pipes`, { name: "Open", visibility: "open" })).body.id;
    tasks.push(await create(alice, { title: `${word} open`, pipeId: open }));
    // Sent by Carol to Alice: Carol is involved.
    tasks.push(await create(carol, { title: `${word} sent`, spaceId: aliceSpace }));
    // A team with Bob: its private pipe.
    const team = (await alice.post("/api/spaces", { name: "Access team", members: [{ userId: bobId }] })).body.id;
    const board = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Board" })).body.id;
    tasks.push(await create(bob, { title: `${word} team`, pipeId: board }));
    // Sent by Carol to the team, then moved into a pipe reserved to the team: Carol no longer sees it.
    const psh = (await alice.post(`/api/spaces/${team}/pipes`, { name: "PSH", kind: "psh" })).body.id;
    const reserved = await create(carol, { title: `${word} reserved`, spaceId: team });
    expect(await ids(carol, word)).toContain(reserved);
    expect((await alice.post(`/api/tasks/${reserved}/move`, { pipeId: psh })).status).toBe(200);
    tasks.push(reserved);

    for (const who of [alice, bob, carol, hidden]) {
      const visible: string[] = [];
      for (const id of tasks) if ((await who.get(`/api/tasks/${id}`)).status === 200) visible.push(id);
      expect((await ids(who, word)).sort()).toEqual(visible.sort());
    }
    // As expected from the app's rules.
    expect((await ids(carol, word)).sort()).toEqual([tasks[1], tasks[2]].sort());
    expect(await ids(hidden, word)).toEqual([]);
  });

  it("finds a task by number only when one may see it", async () => {
    const id = await create(alice, { title: "Numbered secret", pipeId: alicePipe });
    const number = (await alice.get(`/api/tasks/${id}`)).body.number;
    expect(await ids(alice, `TP-${number}`)).toContain(id);
    expect(await ids(carol, `TP-${number}`)).toEqual([]);
  });

  it("shows confidential tasks to their team without an excerpt", async () => {
    const team = (await alice.post("/api/spaces", { name: "Confidential", members: [{ userId: bobId }] })).body.id;
    const psh = (await alice.post(`/api/spaces/${team}/pipes`, { name: "PSH", kind: "psh" })).body.id;
    const id = await create(alice, { title: "Ms quandong", description: "Needs extra time for the guava exam", pipeId: psh, taskType: "accompagnement_psh" });
    const hit = (await search(bob, "guava")).find((h) => h.id === id)!;
    expect(hit).toMatchObject({ confidential: true, snippet: null });
    expect(await ids(carol, "guava")).toEqual([]);
    expect(await ids(carol, "quandong")).toEqual([]);
  });

  it("needs a session", async () => {
    const { agent } = await import("./helpers.js");
    expect((await agent().get("/api/search?q=zebracorn")).status).toBe(401);
  });
});

describe("search index", () => {
  it("is rebuilt at start for tasks missing from it", async () => {
    const id = await create(alice, { title: "Reindexed sapodilla", pipeId: alicePipe });
    await pool.query(`DELETE FROM task_search WHERE task_id = $1`, [id]);
    expect(await ids(alice, "sapodilla")).not.toContain(id);
    const { migrate } = await import("../../src/db.js");
    await migrate({ info() {}, warn() {} } as never);
    expect(await ids(alice, "sapodilla")).toContain(id);
  });
});
