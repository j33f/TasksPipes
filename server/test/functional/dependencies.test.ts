import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";
import { notificationState, runNotifications, type Mail } from "../../src/notifications.js";

let alice: Agent, bob: Agent, carol: Agent, bobId: string, board: string, open: string, carolPipe: string, carolHealth: string;

const newTask = async (a: Agent, pipeId: string, title: string, over: Record<string, unknown> = {}) =>
  (await a.post("/api/tasks", { title, pipeId, ...over })).body.id as string;
const wait = (a: Agent, task: string, blockerId: string) => a.post(`/api/tasks/${task}/dependencies`, { blockerId });
const unblocked = async (task: string) =>
  (await pool.query(`SELECT u.name FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.task_id = $1 AND n.kind = 'unblocked' ORDER BY u.name`, [task])).rows
    .map((r) => r.name);

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  bobId = (await bob.get("/api/me")).body.user.id;
  const team = (await alice.post("/api/spaces", { name: "Dependencies", members: [{ userId: bobId }] })).body.id;
  board = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Private board" })).body.id;
  open = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Open board", visibility: "open" })).body.id;
  const carolSpace = (await carol.get("/api/me")).body.personalSpaceId;
  carolPipe = (await carol.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
  carolHealth = (await carol.post(`/api/spaces/${carolSpace}/pipes`, { name: "Health", kind: "sante" })).body.id;
  notificationState.enabled = true;
});
afterAll(async () => {
  notificationState.enabled = false;
  await stopApp();
});

describe("dependencies", () => {
  it("block a task until what it waits for is finished, shown on its card", async () => {
    const task = await newTask(alice, board, "Release", { assigneeId: bobId });
    const specs = await newTask(alice, board, "Specs");
    const tests = await newTask(alice, board, "Tests");
    expect((await wait(alice, task, specs)).body.blockedBy).toMatchObject([{ id: specs, title: "Specs", visible: true, resolved: false }]);
    await wait(bob, task, tests);
    // Linking twice changes nothing.
    await wait(alice, task, tests);
    const detail = (await alice.get(`/api/tasks/${task}`)).body;
    expect(detail.blockedBy.map((d: { title: string }) => d.title)).toEqual(["Specs", "Tests"]);
    expect(detail.blockers).toBe(2);
    expect(detail.events.filter((e: { type: string }) => e.type === "dependency")).toHaveLength(2);
    expect((await alice.get(`/api/tasks/${specs}`)).body.blocks).toMatchObject([{ id: task, title: "Release" }]);
    const card = (await alice.get(`/api/pipes/${board}`)).body.tasks.find((t: { id: string }) => t.id === task);
    expect(card.blockers).toBe(2);

    await bob.patch(`/api/tasks/${specs}`, { status: "done" });
    expect((await alice.get(`/api/tasks/${task}`)).body.blockers).toBe(1);
    expect(await unblocked(task)).toEqual([]);
    // Abandoned counts as finished; the owner is told, not the person who finished it.
    await alice.patch(`/api/tasks/${tests}`, { status: "abandoned" });
    expect((await alice.get(`/api/tasks/${task}`)).body.blockers).toBe(0);
    expect(await unblocked(task)).toEqual(["Bob Durand"]);

    const sent: Mail[] = [];
    await runNotifications(new Date(Date.now() + 5 * 60_000), async (m) => sent.push(m));
    const mail = sent.find((m) => m.to === "bob@example.com" && m.subject.includes("Release"));
    // Bob was made its owner too: one e-mail tells both.
    expect(mail?.html).toContain("The tasks it waited for are finished");
    expect(mail?.html).not.toContain("Tests");
  });

  it("let a blocked task move on, noted in its history", async () => {
    const task = await newTask(alice, board, "Build");
    await wait(alice, task, await newTask(alice, board, "Design"));
    expect((await alice.patch(`/api/tasks/${task}`, { status: "started" })).status).toBe(200);
    const events = (await alice.get(`/api/tasks/${task}`)).body.events;
    expect(events.at(-1)).toMatchObject({ type: "status", details: { whileBlocked: true } });
    // Going back is no moving on.
    await alice.patch(`/api/tasks/${task}`, { status: "backlog" });
    expect((await alice.get(`/api/tasks/${task}`)).body.events.at(-1).details).toBeNull();
  });

  it("never make a loop", async () => {
    const a = await newTask(alice, board, "A");
    const b = await newTask(alice, board, "B");
    const c = await newTask(alice, board, "C");
    await wait(alice, a, b);
    await wait(alice, b, c);
    expect((await wait(alice, c, a)).body.error).toBe("This task already waits for this one");
    expect((await wait(alice, a, a)).body.error).toBe("A task cannot wait for itself");
  });
});

describe("dependencies and access", () => {
  it("link only tasks one can open, on a task one may edit", async () => {
    const mine = await newTask(alice, board, "Alice's private");
    const carols = await newTask(carol, carolPipe, "Carol's private");
    // Carol's task does not exist for Alice, nor Alice's for Carol.
    expect((await wait(alice, mine, carols)).status).toBe(404);
    expect((await wait(carol, carols, mine)).status).toBe(404);
    expect((await wait(carol, mine, carols)).status).toBe(404);
    expect((await carol.del(`/api/tasks/${mine}/dependencies/${carols}`)).status).toBe(404);
    // Carol sees the open board, but may not edit Alice's tasks there.
    const shown = await newTask(alice, open, "Open, by Alice");
    expect((await wait(carol, shown, carols)).status).toBe(403);
  });

  it("show a blocker one cannot open by its title and owner only, a confidential one not at all", async () => {
    const task = await newTask(carol, open, "Carol's, on the open board");
    const hidden = await newTask(carol, carolPipe, "Carol's errand");
    const health = await newTask(carol, carolHealth, "Doctor appointment", { taskType: "rdv_sante" });
    await wait(carol, task, hidden);
    await wait(carol, task, health);
    const seen = (await alice.get(`/api/tasks/${task}`)).body;
    expect(seen.blockedBy).toEqual([
      { id: hidden, title: "Carol's errand", owner: { name: "Carol Petit" }, resolved: false, visible: false },
      { id: health, resolved: false, visible: false, masked: true },
    ]);
    expect(JSON.stringify(seen)).not.toContain("Doctor");
    expect((await alice.get(`/api/tasks/${hidden}`)).status).toBe(404);
    // Carol sees them all.
    expect((await carol.get(`/api/tasks/${task}`)).body.blockedBy.every((d: { visible: boolean }) => d.visible)).toBe(true);
    // From the hidden blocker's side, what waits for it is shown the same way to someone who cannot open it.
    const waiting = await newTask(alice, board, "Waits for Carol's open task");
    await wait(alice, waiting, task);
    expect((await carol.get(`/api/tasks/${task}`)).body.blocks).toEqual([
      { title: "Waits for Carol's open task", owner: null, resolved: false, visible: false },
    ]);
    // Alice, who manages the board, can still unlink a blocker she cannot open.
    expect((await alice.del(`/api/tasks/${task}/dependencies/${hidden}`)).body.blockedBy).toHaveLength(1);
  });

  it("tell only those who can open the task", async () => {
    const task = await newTask(alice, board, "Private, owned by Bob", { assigneeId: bobId });
    const blocker = await newTask(alice, board, "Blocker");
    await wait(alice, task, blocker);
    // Bob leaves the team: he can no longer open the task.
    await pool.query(`DELETE FROM space_members m USING pipes p WHERE p.id = $1 AND m.space_id = p.space_id AND m.user_id = $2`, [board, bobId]);
    await alice.patch(`/api/tasks/${blocker}`, { status: "done" });
    expect(await unblocked(task)).toEqual([]);
  });
});
