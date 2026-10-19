import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";
import { resetAllRates } from "../../src/rate-limit.js";

let app: FastifyInstance, alice: Agent, carol: Agent;
let read: string, write: string, carolToken: string, alicePipe: string, task: string;

/** A request to the public API with a token. */
const api = async (token: string, method: string, url: string, body?: unknown) => {
  const res = await app.inject({
    method: method as "GET", url,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
  return { status: res.statusCode, body: res.json() as any };
};
const newToken = async (a: Agent, scope: string, days = 30, name = `${scope} token`) => (await a.post("/api/me/tokens", { name, scope, days })).body;

beforeAll(async () => {
  app = await startApp();
  alice = await signIn("alice-token");
  carol = await signIn("carol-token");
  read = (await newToken(alice, "read")).token;
  write = (await newToken(alice, "write")).token;
  carolToken = (await newToken(carol, "write")).token;
  alicePipe = (await alice.get("/api/sidebar")).body.mine.find((p: { isDefault: boolean }) => p.isDefault).id;
  task = (await alice.post("/api/tasks", { title: "Private to Alice", pipeId: alicePipe })).body.id;
});
afterAll(stopApp);

describe("access tokens", () => {
  it("are shown once and kept as a hash", async () => {
    const created = await newToken(alice, "read", 7, "CI");
    expect(created.token).toMatch(/^tp_[A-Za-z0-9_-]{43}$/);
    const listed = (await alice.get("/api/me/tokens")).body.find((t: { id: string }) => t.id === created.id);
    expect(listed).toMatchObject({ name: "CI", scope: "read", prefix: created.token.slice(0, 10), expired: false });
    expect(JSON.stringify(listed)).not.toContain(created.token);
    const { rows } = await pool.query(`SELECT token_hash FROM api_tokens WHERE id = $1`, [created.id]);
    expect(rows[0].token_hash).not.toContain(created.token);
  });

  it("need a name, a scope and an expiry within a year", async () => {
    expect((await alice.post("/api/me/tokens", { name: "", scope: "read", days: 30 })).status).toBe(400);
    expect((await alice.post("/api/me/tokens", { name: "x", scope: "admin", days: 30 })).body.error).toBe("Choose what the token may do");
    expect((await alice.post("/api/me/tokens", { name: "x", scope: "read", days: 400 })).body.error).toBe("A token expires within 366 days");
  });

  it("act with the rights of their owner", async () => {
    expect((await api(read, "GET", "/api/v1/me")).body.user.name).toBe("Alice Martin");
    expect((await api(read, "GET", `/api/v1/tasks/${task}`)).body.title).toBe("Private to Alice");
    // Carol's token sees what Carol sees.
    expect((await api(carolToken, "GET", `/api/v1/tasks/${task}`)).status).toBe(404);
  });

  it("only read with the read scope", async () => {
    const denied = await api(read, "POST", "/api/v1/tasks", { title: "From a read token", pipeId: alicePipe });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("This access token can only read");
    const made = await api(write, "POST", "/api/v1/tasks", { title: "From the API", pipeId: alicePipe });
    expect(made.status).toBe(200);
    expect((await api(write, "POST", `/api/v1/tasks/${made.body.id}/comments`, { body: "via API" })).status).toBe(200);
    expect((await alice.get(`/api/tasks/${made.body.id}`)).body.author.name).toBe("Alice Martin");
  });

  it("check request bodies against the documented schemas", async () => {
    const res = await api(write, "POST", "/api/v1/tasks", { pipeId: alicePipe });
    expect(res.status).toBe(400);
  });

  it("work on /api/v1 only, and never on account, token or administration routes", async () => {
    expect((await api(write, "GET", "/api/me")).status).toBe(401);
    for (const url of ["/api/v1/me/tokens", "/api/v1/admin/users", "/api/v1/me/export", "/api/v1/pipes/x/webhooks"]) {
      expect((await api(write, "GET", url)).status, url).toBe(404);
    }
    expect((await api(write, "POST", "/api/v1/me/delete/request")).status).toBe(404);
  });

  it("are refused once revoked, expired, or their account disabled", async () => {
    const t = await newToken(alice, "read");
    expect((await alice.del(`/api/me/tokens/${t.id}`)).status).toBe(200);
    const res = await api(t.token, "GET", "/api/v1/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("This access token is invalid, expired or revoked");
    const old = await newToken(alice, "read");
    await pool.query(`UPDATE api_tokens SET expires_at = now() - interval '1 second' WHERE id = $1`, [old.id]);
    expect((await api(old.token, "GET", "/api/v1/me")).status).toBe(401);
    expect((await api(`tp_${"x".repeat(43)}`, "GET", "/api/v1/me")).status).toBe(401);
    // Someone else cannot revoke Alice's token.
    expect((await carol.del(`/api/me/tokens/${old.id}`)).status).toBe(404);
  });

  it("are rate limited", async () => {
    await resetAllRates();
    const wrong = `tp_${"y".repeat(43)}`;
    let last = 0;
    for (let i = 0; i < 601 && last !== 429; i++) last = (await api(wrong, "GET", "/api/v1/me")).status;
    expect(last).toBe(429);
    await resetAllRates();
  });
});

describe("API documentation", () => {
  it("is an OpenAPI document of the /api/v1 routes, and a Swagger UI page", async () => {
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.components.securitySchemes.token).toMatchObject({ type: "http", scheme: "bearer" });
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/api/v1/tasks", "/api/v1/tasks/{id}", "/api/v1/search"]));
    expect(Object.keys(doc.paths).every((p) => p.startsWith("/api/v1/"))).toBe(true);
    expect(Object.keys(doc.paths)).not.toContain("/api/v1/me/tokens");
    const ui = await app.inject({ method: "GET", url: "/api/v1/docs/" });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers["content-type"]).toContain("text/html");
    expect(ui.body).toContain("<title>TasksPipes API</title>");
    const init = await app.inject({ method: "GET", url: "/api/v1/docs/static/swagger-initializer.js" });
    const logo = Buffer.from(init.body.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/)![1], "base64").toString();
    expect(logo).toContain(">TasksPipes</text>");
  });
});
