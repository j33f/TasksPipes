import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

let alice: Agent, bob: Agent, team: string, pipe: string;

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  team = (await alice.post("/api/spaces", { name: "Pipe documents", members: [] })).body.id;
  pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Website redesign", description: "The new site" })).body.id;
});
afterAll(stopApp);

describe("The Outline document of a pipe", () => {
  it("is none at first", async () => {
    expect((await alice.get(`/api/pipes/${pipe}`)).body.outlineDoc).toBeNull();
  });

  it("is linked and unlinked by the pipe's members, other changes keeping it", async () => {
    const doc = { id: "doc-1", title: "Roadmap 2027", url: "/doc/roadmap-2027-abc123" };
    expect((await alice.patch(`/api/pipes/${pipe}`, { outlineDoc: doc })).status).toBe(200);
    const linked = (await alice.get(`/api/pipes/${pipe}`)).body.outlineDoc;
    expect(linked).toEqual({ id: "doc-1", title: "Roadmap 2027", url: expect.stringMatching(/^http:\/\/localhost:\d+\/doc\/roadmap-2027-abc123$/) });

    await alice.patch(`/api/pipes/${pipe}`, { name: "Website redesign 2027" });
    expect((await alice.get(`/api/pipes/${pipe}`)).body.outlineDoc).toEqual(linked);
    // Listed with the team's pipes too.
    const listed = (await alice.get(`/api/spaces/${team}`)).body.pipes.find((p: { id: string }) => p.id === pipe);
    expect(listed.outlineDoc).toEqual(linked);

    await alice.patch(`/api/pipes/${pipe}`, { outlineDoc: null });
    expect((await alice.get(`/api/pipes/${pipe}`)).body.outlineDoc).toBeNull();
  });

  it("must be a document", async () => {
    const res = await alice.patch(`/api/pipes/${pipe}`, { outlineDoc: { title: "No id" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid Outline document");
  });

  it("can be created in Outline from the pipe, then linked to it", async () => {
    expect((await alice.post(`/api/pipes/${pipe}/outline-document`, {})).status).toBe(400);
    const res = await alice.post(`/api/pipes/${pipe}/outline-document`, { collectionId: "col-1" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "Website redesign 2027", collectionId: "col-1" });
    expect((await alice.get(`/api/pipes/${pipe}`)).body.outlineDoc).toEqual({ id: res.body.id, title: res.body.title, url: res.body.url });
  });

  it("is out of reach of people outside the team", async () => {
    const doc = { id: "doc-2", title: "Guide d'onboarding", url: "/doc/guide-onboarding-def456" };
    expect((await bob.patch(`/api/pipes/${pipe}`, { outlineDoc: doc })).status).toBe(404);
    expect((await bob.post(`/api/pipes/${pipe}/outline-document`, { collectionId: "col-1" })).status).toBe(404);
  });
});
