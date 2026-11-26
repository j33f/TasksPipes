import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

let alice: Agent, bob: Agent, carol: Agent;
let aliceId: string, bobId: string, mySpace: string, team: string, other: string;

const newPipe = async (who: Agent, space: string, name: string) => (await who.post(`/api/spaces/${space}/pipes`, { name, kind: "dev" })).body.id as string;
const move = (who: Agent, pipe: string, spaceId: string) => who.post(`/api/pipes/${pipe}/move`, { spaceId });

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  const me = (await alice.get("/api/me")).body;
  aliceId = me.user.id;
  mySpace = me.personalSpaceId;
  bobId = (await bob.get("/api/me")).body.user.id;
  team = (await alice.post("/api/spaces", { name: "Movers", members: [{ userId: bobId }] })).body.id;
  // A team where Bob is admin and Alice a member.
  other = (await bob.post("/api/spaces", { name: "Bob's team", members: [{ userId: aliceId }] })).body.id;
});
afterAll(stopApp);

describe("moving a pipe to a team", () => {
  it("takes a personal pipe there with its tasks, labels and history", async () => {
    const pipe = await newPipe(alice, mySpace, "Side project");
    const label = (await alice.post(`/api/spaces/${mySpace}/labels`, { name: "Urgent", color: "#e5484d" })).body.id;
    const task = (await alice.post("/api/tasks", { title: "Ship it", pipeId: pipe })).body.id;
    await alice.patch(`/api/tasks/${task}`, { labelIds: [label] });
    await alice.post(`/api/tasks/${task}/items`, { text: "Step one" });

    // Not Bob's to see yet.
    expect((await bob.get(`/api/tasks/${task}`)).status).toBe(404);
    const res = await move(alice, pipe, team);
    expect(res.status).toBe(200);
    expect(res.body.tasks).toBe(1);

    const seen = (await bob.get(`/api/tasks/${task}`)).body;
    expect(seen.space.id).toBe(team);
    expect(seen.pipe.id).toBe(pipe);
    // Hers without saying so in her space, now named as its owner.
    expect(seen.assignee.id).toBe(aliceId);
    expect(seen.items.map((i: { text: string }) => i.text)).toEqual(["Step one"]);
    // The label is now the team's.
    const teamLabels = (await bob.get(`/api/spaces/${team}/labels`)).body;
    expect(teamLabels.map((l: { name: string }) => l.name)).toContain("Urgent");
    expect(seen.labels.map((l: { id: string }) => l.id)).toEqual([teamLabels.find((l: { name: string }) => l.name === "Urgent").id]);
    // Noted in its history.
    const last = seen.events.find((e: { type: string }) => e.type === "moved");
    expect(last.details).toMatchObject({ withPipe: true });
    // The pipe is listed with the team's.
    expect((await bob.get(`/api/spaces/${team}`)).body.pipes.map((p: { id: string }) => p.id)).toContain(pipe);
  });

  it("reuses the team's label of the same name", async () => {
    await alice.post(`/api/spaces/${team}/labels`, { name: "Design", color: "#3e63dd" });
    const pipe = await newPipe(alice, mySpace, "Mockups");
    const mine = (await alice.post(`/api/spaces/${mySpace}/labels`, { name: "design", color: "#30a46c" })).body.id;
    const task = (await alice.post("/api/tasks", { title: "Logo", pipeId: pipe })).body.id;
    await alice.patch(`/api/tasks/${task}`, { labelIds: [mine] });
    await move(alice, pipe, team);
    const labels = (await alice.get(`/api/spaces/${team}/labels`)).body.filter((l: { name: string }) => l.name.toLowerCase() === "design");
    expect(labels).toHaveLength(1);
    expect((await alice.get(`/api/tasks/${task}`)).body.labels[0]).toMatchObject({ id: labels[0].id, name: "Design" });
  });

  it("unassigns owners who are not members of the team", async () => {
    // From Bob's team (he is its admin) to Alice's, where Bob is a member: Carol, not a member, loses her task.
    const carolId = (await carol.get("/api/me")).body.user.id;
    await bob.post(`/api/spaces/${other}/members`, { userId: carolId });
    const pipe = await newPipe(bob, other, "Shared");
    const kept = (await bob.post("/api/tasks", { title: "Bob's", pipeId: pipe, assigneeId: bobId })).body.id;
    const dropped = (await bob.post("/api/tasks", { title: "Carol's", pipeId: pipe, assigneeId: carolId })).body.id;
    expect((await move(bob, pipe, team)).status).toBe(200);
    expect((await bob.get(`/api/tasks/${kept}`)).body.assignee.id).toBe(bobId);
    expect((await bob.get(`/api/tasks/${dropped}`)).body.assignee).toBeNull();
  });

  it("is refused where it should be", async () => {
    // A team's pipe, by a member who is not its admin.
    const theirs = await newPipe(bob, other, "Bob's board");
    const notAdmin = await move(alice, theirs, team);
    expect(notAdmin.status).toBe(403);
    expect(notAdmin.body.error).toBe("Only an admin of the team can move its pipes elsewhere");
    // The default pipe of a personal space.
    const byDefault = (await alice.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
    expect((await move(alice, byDefault, team)).body.error).toBe("The default pipe of a personal space cannot be moved");
    // To a personal space, to a team one is not in, to where it already is.
    const pipe = await newPipe(alice, mySpace, "Stays");
    const bobSpace = (await bob.get("/api/me")).body.personalSpaceId;
    expect((await move(alice, pipe, bobSpace)).status).toBe(404);
    expect((await move(alice, pipe, mySpace)).body.error).toBe("This pipe is already in this space");
    const carolTeam = (await carol.post("/api/spaces", { name: "Carol only" })).body.id;
    expect((await move(alice, pipe, carolTeam)).status).toBe(404);
    // Someone else's personal pipe.
    expect((await move(bob, pipe, team)).status).toBe(404);
  });
});
