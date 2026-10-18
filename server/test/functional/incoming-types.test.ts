import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, signInWithLink, startApp, stopApp, type Agent } from "./helpers.js";

// Fresh spaces, so that the pipes other test files make do not count.
let alice: Agent, carol: Agent, carolSpace: string, team: string;

const send = (a: Agent, spaceId: string, taskType: string) => a.post("/api/tasks", { title: `A ${taskType}`, spaceId, taskType });

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  carol = await signInWithLink((await alice.post("/api/invitations", { email: "types-recipient@example.com", name: "Carla Types" })).body.link);
  carolSpace = (await carol.get("/api/me")).body.personalSpaceId;
  team = (await alice.post("/api/spaces", { name: "Types" })).body.id;
  // Carol's open pipe is software, her private one sales.
  await carol.post(`/api/spaces/${carolSpace}/pipes`, { name: "Software", kind: "dev", visibility: "open" });
  await carol.post(`/api/spaces/${carolSpace}/pipes`, { name: "Sales", kind: "commercial" });
});
afterAll(stopApp);

describe("task types sent to an incoming", () => {
  it("are those of the recipient's open pipes, and the plain task", async () => {
    expect((await send(alice, carolSpace, "bug")).status).toBe(200);
    expect((await send(alice, carolSpace, "task")).status).toBe(200);
    // Her private sales pipe does not count: Alice cannot see it.
    const res = await send(alice, carolSpace, "opportunite");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This task type fits none of the recipient's pipes");
    // The same answer for a type no pipe of hers offers.
    expect((await send(alice, carolSpace, "candidature")).body.error).toBe(res.body.error);
  });

  it("are those of all one's own pipes in one's own incoming", async () => {
    expect((await send(carol, carolSpace, "opportunite")).status).toBe(200);
    await alice.post(`/api/spaces/${team}/pipes`, { name: "Private sales", kind: "commercial" });
    expect((await send(alice, team, "opportunite")).status).toBe(200);
    expect((await send(alice, team, "bug")).status).toBe(400);
  });

  it("follow archived pipes out", async () => {
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Old software", kind: "dev" })).body.id;
    expect((await send(alice, team, "bug")).status).toBe(200);
    await alice.patch(`/api/pipes/${pipe}`, { archived: true });
    expect((await send(alice, team, "bug")).status).toBe(400);
  });
});

describe("turning a task into another type", () => {
  it("happens when accepting it into a pipe offering that type, and is recorded", async () => {
    const task = (await send(alice, carolSpace, "bug")).body.id;
    const sales = (await carol.get(`/api/spaces/${carolSpace}`)).body.pipes.find((p: { name: string }) => p.name === "Sales").id;
    // Sales offers no user story.
    expect((await carol.post(`/api/tasks/${task}/move`, { pipeId: sales, taskType: "user_story" })).body.error).toBe("Invalid task type");
    expect((await carol.post(`/api/tasks/${task}/move`, { pipeId: sales, taskType: "opportunite" })).status).toBe(200);
    const detail = (await carol.get(`/api/tasks/${task}`)).body;
    expect(detail).toMatchObject({ taskType: "opportunite", pipe: { id: sales } });
    expect(detail.events.at(-1)).toMatchObject({ type: "accepted", details: { taskType: { to: "Opportunity" } } });
  });

  it("keeps the type when none is given", async () => {
    const task = (await send(alice, carolSpace, "bug")).body.id;
    const software = (await carol.get(`/api/spaces/${carolSpace}`)).body.pipes.find((p: { name: string }) => p.name === "Software").id;
    await carol.post(`/api/tasks/${task}/move`, { pipeId: software });
    expect((await carol.get(`/api/tasks/${task}`)).body.taskType).toBe("bug");
  });
});
