import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, signIn, signInWithLink, startApp, stopApp, type Agent } from "./helpers.js";

let alice: Agent, bob: Agent, carol: Agent;
const names = async (a: Agent) => (await a.get("/api/users")).body.map((u: { name: string }) => u.name);

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
});
afterAll(stopApp);

describe("teams", () => {
  it("are managed by their admins and visible to their members", async () => {
    const bobId = (await bob.get("/api/me")).body.user.id;
    const team = (await alice.post("/api/spaces", { name: "Trainers", members: [{ userId: bobId }] })).body.id;
    expect((await bob.get(`/api/spaces/${team}`)).body.members.map((m: { name: string }) => m.name)).toEqual(expect.arrayContaining(["Alice Martin", "Bob Durand"]));
    expect((await bob.patch(`/api/spaces/${team}`, { name: "Renamed" })).status).toBe(403);
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Board" })).body.id;
    const task = (await bob.post("/api/tasks", { title: "Team task", pipeId: pipe, assigneeId: bobId })).body.id;
    expect((await alice.get(`/api/tasks/${task}`)).body.assignee.name).toBe("Bob Durand");
    // Carol, an Outline account of the same server, can see the team but not its private pipe.
    expect((await carol.get(`/api/pipes/${pipe}`)).status).toBe(404);
  });

  it("keep at least one admin", async () => {
    const team = (await carol.post("/api/spaces", { name: "Solo", members: [] })).body.id;
    const carolId = (await carol.get("/api/me")).body.user.id;
    expect((await carol.patch(`/api/spaces/${team}/members/${carolId}`, { role: "member" })).status).toBe(400);
  });

  it("can hold the disability follow-up, whose tasks never leave the team", async () => {
    const space = (await alice.get("/api/me")).body.personalSpaceId;
    expect((await alice.post(`/api/spaces/${space}/pipes`, { name: "PSH", kind: "psh" })).status).toBe(400);
    const team = (await alice.post("/api/spaces", { name: "PSH team", members: [] })).body.id;
    const pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "PSH", kind: "psh", visibility: "open" })).body;
    expect((await alice.get(`/api/pipes/${pipe.id}`)).body.visibility).toBe("private");
    const task = (await alice.post("/api/tasks", { title: "Ms L.", pipeId: pipe.id, taskType: "accompagnement_psh", fields: { rqth: "Oui" } })).body.id;
    const bobSpace = (await bob.get("/api/me")).body.personalSpaceId;
    expect((await alice.post(`/api/tasks/${task}/send`, { spaceId: bobSpace })).status).toBe(400);
  });
});

describe("invitations by e-mail", () => {
  let gina: Agent, ginaId: string;

  it("create an account and a sign-in link (no SMTP in tests)", async () => {
    const res = await alice.post("/api/invitations", { email: "Gina@Example.com", name: "Gina" });
    expect(res.body).toMatchObject({ created: true, sent: false });
    gina = await signInWithLink(res.body.link);
    const me = (await gina.get("/api/me")).body;
    ginaId = me.user.id;
    expect(me.user).toMatchObject({ name: "Gina", kind: "email", email: "gina@example.com" });
    expect((await gina.post("/api/auth/magic", { token: new URL(res.body.link).searchParams.get("token") })).status).toBe(400);
  });

  it("make the two people see each other, and nobody else", async () => {
    expect(await names(gina)).toEqual(expect.arrayContaining(["Alice Martin", "Gina"]));
    expect(await names(gina)).not.toContain("Bob Durand");
    expect(await names(bob)).not.toContain("Gina");
    expect(await names(alice)).toContain("Gina");
    const bobSpace = (await bob.get("/api/me")).body.personalSpaceId;
    expect((await gina.post("/api/tasks", { title: "x", spaceId: bobSpace })).status).toBe(404);
  });

  it("send a request to people already on TasksPipes, which they accept", async () => {
    expect((await gina.post("/api/invitations", { email: "bob@example.com" })).body).toEqual({ created: false, sent: true });
    expect(await names(gina)).not.toContain("Bob Durand");
    const requests = (await bob.get("/api/invitations")).body.filter((i: { status: string; invitedByMe: boolean }) => i.status === "pending" && !i.invitedByMe);
    expect(requests.map((i: { name: string }) => i.name)).toEqual(["Gina"]);
    expect((await bob.post(`/api/invitations/${ginaId}/accept`)).status).toBe(200);
    expect(await names(gina)).toContain("Bob Durand");
    expect(await names(bob)).toContain("Gina");
  });

  it("let people refuse, silently for the inviter", async () => {
    await gina.post("/api/invitations", { email: "carol@example.com" });
    expect((await carol.post(`/api/invitations/${ginaId}/refuse`)).status).toBe(200);
    expect((await gina.post("/api/invitations", { email: "carol@example.com" })).body).toEqual({ created: false, sent: true });
    const pending = (await carol.get("/api/invitations")).body.filter((i: { status: string }) => i.status === "pending");
    expect(pending).toHaveLength(0);
    expect(await names(gina)).not.toContain("Carol Petit");
  });

  it("accept a pending request when invited back", async () => {
    const hugo = await signInWithLink((await alice.post("/api/invitations", { email: "hugo@example.com", name: "Hugo" })).body.link);
    await hugo.post("/api/invitations", { email: "gina@example.com" });
    const res = await gina.post("/api/invitations", { email: "hugo@example.com" });
    expect(res.body).toMatchObject({ connected: true, name: "Hugo" });
    expect(await names(hugo)).toContain("Gina");
  });

  it("let e-mail accounts turn on two-factor authentication", async () => {
    const setup = await gina.post("/api/me/totp/setup");
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect((await gina.post("/api/me/totp/enable", { code: "000000" })).status).toBe(400);
    expect((await alice.post("/api/me/totp/setup")).status).toBe(400);
  });

  it("keep Outline out of reach of e-mail accounts", async () => {
    expect((await gina.get("/api/outline/documents?q=road")).status).toBe(403);
    expect((await alice.get("/api/outline/documents?q=road")).body.map((d: { title: string }) => d.title)).toEqual(["Roadmap 2027"]);
  });

  it("let e-mail accounts set a checked profile picture", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
    const app = (await import("./helpers.js")).startApp;
    const fastify = await app();
    const upload = (cookie: string, body: Buffer) =>
      fastify.inject({ method: "POST", url: "/api/me/avatar", headers: { cookie, "content-type": "application/octet-stream", "x-file-type": "image/png" }, payload: body });
    expect((await upload(gina.cookie, png)).statusCode).toBe(200);
    expect((await upload(gina.cookie, Buffer.from("not an image"))).statusCode).toBe(400);
    expect((await upload(alice.cookie, png)).statusCode).toBe(400);
    const url = (await alice.get("/api/users")).body.find((u: { name: string }) => u.name === "Gina").avatarUrl;
    const res = await fastify.inject({ method: "GET", url, headers: { cookie: alice.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
  });

  it("refuse to invite oneself and bad addresses", async () => {
    expect((await gina.post("/api/invitations", { email: "gina@example.com" })).body.error).toBe("That is your own address");
    expect((await agent(gina.cookie, "fr").post("/api/invitations", { email: "nope" })).body.error).toBe("Adresse e-mail invalide");
  });
});
