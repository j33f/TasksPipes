/**
 * Incoming webhooks (incoming.ts): another application creates tasks in a pipe, as the member who set it up,
 * authenticated by the secret or a signature; templates pick fields out of any body; an externalId makes no duplicate.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

let app: FastifyInstance, alice: Agent, bob: Agent, pipe: string, url: string, secret: string;

beforeAll(async () => {
  app = await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  const bobId = (await bob.get("/api/me")).body.user.id;
  const team = (await alice.post("/api/spaces", { name: "Webhook team", members: [{ userId: bobId }] })).body.id;
  pipe = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Leads" })).body.id;
  const made = (await alice.post(`/api/pipes/${pipe}/integrations`, { provider: "incoming" })).body;
  url = new URL(made.url).pathname;
  secret = made.secret;
});
afterAll(stopApp);

const post = (body: unknown, headers: Record<string, string> = { "x-taskspipes-token": secret }, contentType = "application/json") =>
  app.inject({ method: "POST", url, headers: { "content-type": contentType, ...headers }, payload: typeof body === "string" ? body : JSON.stringify(body) });

describe("incoming webhooks", () => {
  it("are set up by the pipe's members, with a URL and a secret", async () => {
    const list = (await alice.get(`/api/pipes/${pipe}/integrations`)).body;
    expect(list.find((x: { provider: string }) => x.provider === "incoming")).toMatchObject({ url: expect.stringMatching(/\/hooks\/incoming\//), templates: {} });
    const carol = await signIn("carol-token");
    // Someone who does not see the pipe is told nothing of it.
    expect((await carol.post(`/api/pipes/${pipe}/integrations`, { provider: "incoming" })).status).toBe(404);
  });

  it("create a task, as the one who set it up, with the secret in a header", async () => {
    const res = await post({ title: "Call ACME", description: "From the form", dueDate: "2026-12-01T10:00:00Z", priority: 2 });
    expect(res.statusCode).toBe(201);
    const { task } = res.json();
    const t = (await alice.get(`/api/tasks/${task.id}`)).body;
    expect(t).toMatchObject({ title: "Call ACME", description: "From the form", dueDate: "2026-12-01", priority: 2, pipe: { id: pipe } });
    expect(t.events[0]).toMatchObject({ actor: { name: "Alice Martin" }, comment: "Created by an incoming webhook" });
    // Bearer works too.
    expect((await post({ title: "Bearer" }, { authorization: `Bearer ${secret}` })).statusCode).toBe(201);
  });

  it("accept a signature of the body instead of the secret, and refuse anything else", async () => {
    const body = JSON.stringify({ title: "Signed" });
    const signature = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
    expect((await post(body, { "x-taskspipes-signature": signature })).statusCode).toBe(201);
    expect((await post(body, { "x-taskspipes-signature": "sha256=00" })).statusCode).toBe(401);
    expect((await post({ title: "No secret" }, {})).statusCode).toBe(401);
    expect((await post({ title: "Wrong" }, { "x-taskspipes-token": "nope" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/hooks/incoming/unknown", payload: "{}" })).statusCode).toBe(404);
  });

  it("pick the task out of any body with templates, and take forms too", async () => {
    const set = await alice.patch(`/api/pipes/${pipe}/integrations/incoming`, {
      templates: { title: "Lead: {{contact.name}}", description: "{{contact.email}} — {{message}}", externalId: "{{id}}" },
    });
    expect(set.body.templates).toMatchObject({ title: "Lead: {{contact.name}}" });
    const res = await post({ id: "lead-1", contact: { name: "Zoé", email: "zoe@example.com" }, message: "Hello" });
    expect(res.statusCode).toBe(201);
    const t = (await alice.get(`/api/tasks/${res.json().task.id}`)).body;
    expect(t).toMatchObject({ title: "Lead: Zoé", description: "zoe@example.com — Hello" });
    // Sent again (a retry): no second task.
    const again = await post({ id: "lead-1", contact: { name: "Zoé" } });
    expect(again.json()).toMatchObject({ duplicate: true, task: { id: res.json().task.id } });
    // A form, with the same templates (no nesting: an empty name).
    const form = await post("id=lead-2&message=Hi", undefined, "application/x-www-form-urlencoded");
    expect(form.statusCode).toBe(201);
  });

  it("never let another application @mention people, or send huge bodies, or race a retry into two tasks", async () => {
    await alice.patch(`/api/pipes/${pipe}/integrations/incoming`, { templates: {} });
    const bobId = (await bob.get("/api/me")).body.user.id;
    const res = await post({ title: "Hi @[Bob](mention:" + bobId + ")", description: "See @[Bob Durand](mention:" + bobId + ")" });
    const t = (await alice.get(`/api/tasks/${res.json().task.id}`)).body;
    expect(t.title).toBe("Hi @Bob");
    expect(t.description).toBe("See @Bob Durand");
    expect(t.events[0].details?.mentioned).toBeUndefined();

    expect((await post({ title: "x", description: "y".repeat(300 * 1024) })).statusCode).toBe(413);

    const same = { title: "Twice at once", externalId: "race-1" };
    const [a, b] = await Promise.all([post(same), post(same)]);
    const ids = new Set([a.json().task.id, b.json().task.id]);
    expect(ids.size).toBe(1);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
  });

  it("say what is wrong", async () => {
    await alice.patch(`/api/pipes/${pipe}/integrations/incoming`, { templates: {} });
    expect((await post({ description: "no title" })).json().error).toMatch(/No title/);
    expect((await post("{not json")).statusCode).toBe(400);
  });

  it("stop creating tasks once their author may no longer add to the pipe", async () => {
    // Bob takes the webhook over (his templates), then leaves the team.
    await bob.patch(`/api/pipes/${pipe}/integrations/incoming`, { templates: {} });
    const team = (await alice.get(`/api/pipes/${pipe}`)).body.space.id;
    const bobId = (await bob.get("/api/me")).body.user.id;
    await alice.del(`/api/spaces/${team}/members/${bobId}`);
    const res = await post({ title: "After Bob left" });
    expect(res.statusCode).toBe(403);
  });
});
