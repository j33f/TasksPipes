/**
 * OAuth for remote MCP clients (oauth.ts): discovery, dynamic registration and metadata documents (CIMD), the
 * authorization code with PKCE through the person's consent, tokens for /mcp only, refresh rotation and what makes
 * a grant die (a refresh token or a code used twice, disconnecting).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { overrideSetting } from "../../src/settings-store.js";
import { pool } from "../../src/db.js";

const APP = "http://tasks.test";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
let app: FastifyInstance, alice: Agent, team: string;
let metadata: http.Server, metadataBase: string;
let metadataDoc: (url: string) => object = () => ({});

beforeAll(async () => {
  app = await startApp();
  overrideSetting("mcp.enabled", true);
  alice = await signIn("alice-token");
  team = (await alice.post("/api/spaces", { name: "OAuth team" })).body.id;
  // Where a client publishes its metadata document (CIMD).
  metadata = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(metadataDoc(`${metadataBase}${req.url}`)));
  });
  await new Promise<void>((r) => metadata.listen(0, "127.0.0.1", r));
  metadataBase = `http://127.0.0.1:${(metadata.address() as AddressInfo).port}`;
});

afterAll(async () => {
  overrideSetting("mcp.enabled", undefined);
  await new Promise((r) => metadata.close(r));
  await stopApp();
});

const get = (url: string) => app.inject({ method: "GET", url });
const form = (url: string, body: Record<string, string>) =>
  app.inject({ method: "POST", url, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams(body).toString() });
const pkce = () => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
};
const mcp = (token: string) =>
  app.inject({
    method: "POST", url: "/mcp",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }),
  });
const whoami = async (token: string) => {
  const res = await mcp(token);
  if (res.statusCode !== 200) return { status: res.statusCode };
  const line = res.body.split("\n").filter((l) => l.startsWith("data:")).at(-1) ?? `data:${res.body}`;
  return JSON.parse(JSON.parse(line.slice(5)).result.content[0].text);
};

const register = (redirect = CALLBACK, extra: object = {}) =>
  app.inject({ method: "POST", url: "/oauth/register", payload: { client_name: "Claude", redirect_uris: [redirect], ...extra } });

/** The authorization request of a client: where it is sent (the consent page), and the request's id. */
async function authorize(clientId: string, params: Record<string, string> = {}) {
  const { verifier, challenge } = pkce();
  const q = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256",
    state: "xyz", scope: "tasks:read tasks:write", resource: `${APP}/mcp`, ...params,
  });
  const res = await get(`/oauth/authorize?${q}`);
  const location = String(res.headers.location ?? "");
  return { res, location, verifier, request: location ? new URL(location).searchParams.get("request") ?? "" : "" };
}

/** The whole flow, consenting with these choices: the tokens. */
async function connect(choice: object = { scopes: ["tasks:write"] }) {
  const clientId = (await register()).json().client_id;
  const a = await authorize(clientId);
  const approved = await alice.post(`/api/oauth/requests/${a.request}/approve`, choice);
  const code = new URL(approved.body.redirect).searchParams.get("code")!;
  const token = await form("/oauth/token", {
    grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: a.verifier, resource: `${APP}/mcp`,
  });
  return { clientId, tokens: token.json(), status: token.statusCode };
}

describe("discovery", () => {
  it("points from /mcp to the protected resource and authorization server metadata", async () => {
    const challenge = String((await app.inject({ method: "POST", url: "/mcp", payload: {} })).headers["www-authenticate"]);
    expect(challenge).toBe(`Bearer resource_metadata="${APP}/.well-known/oauth-protected-resource/mcp"`);
    const prm = (await get("/.well-known/oauth-protected-resource/mcp")).json();
    expect(prm).toMatchObject({ resource: `${APP}/mcp`, authorization_servers: [APP] });
    expect((await get("/.well-known/oauth-protected-resource")).statusCode).toBe(200);
    const as = (await get("/.well-known/oauth-authorization-server")).json();
    expect(as).toMatchObject({
      issuer: APP, code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true, registration_endpoint: `${APP}/oauth/register`,
    });
  });

  it("is off with AI agents", async () => {
    overrideSetting("mcp.enabled", false);
    expect((await get("/.well-known/oauth-authorization-server")).statusCode).toBe(404);
    expect((await register()).statusCode).toBe(404);
    overrideSetting("mcp.enabled", true);
  });
});

describe("registering a client", () => {
  it("never shows a client under the instance's own name", async () => {
    const id = (await register(CALLBACK, { client_name: "TasksPipes official" })).json().client_id;
    const a = await authorize(id);
    expect((await alice.get(`/api/oauth/requests/${a.request}`)).body.client).toMatchObject({ name: "MCP client", verified: false });
  });

  it("takes public clients with https or loopback redirect URIs only", async () => {
    const ok = await register();
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ client_id: expect.stringMatching(/^tpc_/), token_endpoint_auth_method: "none" });
    expect((await register("http://evil.example/cb")).statusCode).toBe(400);
    expect((await register(CALLBACK, { token_endpoint_auth_method: "client_secret_basic" })).statusCode).toBe(400);
    expect((await register("http://127.0.0.1/callback")).statusCode).toBe(201);
  });
});

describe("the authorization code flow", () => {
  it("asks the person, then gives tokens for /mcp with what they chose", async () => {
    const clientId = (await register()).json().client_id;
    const a = await authorize(clientId);
    expect(a.res.statusCode).toBe(302);
    expect(a.location).toMatch(new RegExp(`^${APP}/oauth/consent\\?request=`));
    const shown = (await alice.get(`/api/oauth/requests/${a.request}`)).body;
    expect(shown).toMatchObject({ client: { name: "Claude", redirectHost: "claude.ai" }, scopes: ["tasks:read", "tasks:write"] });
    // Signed out, nothing to see or approve.
    expect((await app.inject({ method: "GET", url: `/api/oauth/requests/${a.request}` })).statusCode).toBe(403);

    const approved = await alice.post(`/api/oauth/requests/${a.request}/approve`, { scopes: ["tasks:write"], spaceIds: [team] });
    const back = new URL(approved.body.redirect);
    expect(back.origin + back.pathname).toBe(CALLBACK);
    expect(back.searchParams.get("state")).toBe("xyz");
    expect(back.searchParams.get("iss")).toBe(APP);
    // A request is approved once.
    expect((await alice.post(`/api/oauth/requests/${a.request}/approve`, {})).status).toBe(404);

    const res = await form("/oauth/token", {
      grant_type: "authorization_code", code: back.searchParams.get("code")!, redirect_uri: CALLBACK, client_id: clientId, code_verifier: a.verifier,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const t = res.json();
    expect(t).toMatchObject({ token_type: "Bearer", expires_in: 3600, access_token: expect.stringMatching(/^tpo_/), refresh_token: expect.stringMatching(/^tpr_/) });
    expect(await whoami(t.access_token)).toMatchObject({ scopes: ["tasks:read", "tasks:write"], spaces: [team] });
    // For /mcp only: not the REST API.
    expect((await app.inject({ method: "GET", url: "/api/v1/me/tasks", headers: { authorization: `Bearer ${t.access_token}` } })).statusCode).toBe(403);
    // Listed with the person's agents, by the client's name.
    const grant = (await alice.get("/api/me/tokens")).body.find((x: { prefix: string; kind: string }) => x.prefix === "oauth" && x.kind === "agent");
    expect(grant).toMatchObject({ name: "Claude", spaceIds: [team] });
  });

  it("refuses a wrong verifier, another redirect URI, and a code used twice", async () => {
    const clientId = (await register()).json().client_id;
    const a = await authorize(clientId);
    const code = new URL((await alice.post(`/api/oauth/requests/${a.request}/approve`, {})).body.redirect).searchParams.get("code")!;
    const base = { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CALLBACK };
    expect((await form("/oauth/token", { ...base, code_verifier: pkce().verifier })).json().error).toBe("invalid_grant");
    // That attempt used the code: the right verifier comes too late.
    expect((await form("/oauth/token", { ...base, code_verifier: a.verifier })).json().error).toBe("invalid_grant");
    const b = await authorize(clientId);
    const code2 = new URL((await alice.post(`/api/oauth/requests/${b.request}/approve`, {})).body.redirect).searchParams.get("code")!;
    const other = await form("/oauth/token", { grant_type: "authorization_code", code: code2, client_id: clientId, redirect_uri: "https://claude.ai/other", code_verifier: b.verifier });
    expect(other.json().error).toBe("invalid_grant");
  });

  it("revokes the tokens a code gave when it is used again", async () => {
    const clientId = (await register()).json().client_id;
    const a = await authorize(clientId);
    const code = new URL((await alice.post(`/api/oauth/requests/${a.request}/approve`, {})).body.redirect).searchParams.get("code")!;
    const body = { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CALLBACK, code_verifier: a.verifier };
    const first = (await form("/oauth/token", body)).json();
    expect((await whoami(first.access_token)).actingFor).toBe("Alice Martin");
    expect((await form("/oauth/token", body)).json().error).toBe("invalid_grant");
    expect((await mcp(first.access_token)).statusCode).toBe(401);
  });

  it("sends errors back to the client, but never to a redirect URI it did not register", async () => {
    const clientId = (await register()).json().client_id;
    const wrongResource = await authorize(clientId, { resource: "https://elsewhere.example/mcp" });
    expect(new URL(wrongResource.location).searchParams.get("error")).toBe("invalid_target");
    const noPkce = await authorize(clientId, { code_challenge_method: "plain" });
    expect(new URL(noPkce.location).searchParams.get("error")).toBe("invalid_request");
    const unregistered = await authorize(clientId, { redirect_uri: "https://evil.example/cb" });
    expect(unregistered.res.statusCode).toBe(400);
    expect(unregistered.location).toBe("");
    expect((await authorize("tpc_unknown")).res.statusCode).toBe(400);
    // The redirect URI is always asked for.
    const { challenge } = pkce();
    const without = await get(`/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, code_challenge: challenge, code_challenge_method: "S256" })}`);
    expect(without.statusCode).toBe(400);
  });

  it("lets the person refuse", async () => {
    const clientId = (await register()).json().client_id;
    const a = await authorize(clientId);
    const denied = await alice.post(`/api/oauth/requests/${a.request}/deny`);
    expect(new URL(denied.body.redirect).searchParams.get("error")).toBe("access_denied");
  });

  it("accepts any port of a registered loopback redirect URI (native clients)", async () => {
    const clientId = (await register("http://127.0.0.1/callback")).json().client_id;
    const a = await authorize(clientId, { redirect_uri: "http://127.0.0.1:53111/callback" });
    expect(a.location).toMatch(/\/oauth\/consent\?request=/);
  });
});

describe("refresh tokens", () => {
  it("are rotated; a used one replayed later revokes the whole grant", async () => {
    const { clientId, tokens } = await connect();
    const refresh = (token: string) => form("/oauth/token", { grant_type: "refresh_token", refresh_token: token, client_id: clientId });
    const next = (await refresh(tokens.refresh_token)).json();
    expect(next.access_token).toMatch(/^tpo_/);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect((await whoami(next.access_token)).actingFor).toBe("Alice Martin");
    // Retried at once (a client refreshing twice): refused, nothing revoked.
    expect((await refresh(tokens.refresh_token)).json().error).toBe("invalid_grant");
    expect((await whoami(next.access_token)).actingFor).toBe("Alice Martin");
    // Replayed later: a stolen token — the grant goes.
    await pool.query(`UPDATE oauth_tokens SET used_at = now() - interval '1 minute' WHERE used_at IS NOT NULL`);
    expect((await refresh(tokens.refresh_token)).json().error).toBe("invalid_grant");
    expect((await mcp(next.access_token)).statusCode).toBe(401);
  });

  it("only work for their own client", async () => {
    const { tokens } = await connect();
    const other = (await register()).json().client_id;
    expect((await form("/oauth/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: other })).json().error).toBe("invalid_grant");
  });
});

describe("disconnecting", () => {
  it("from the settings ends every token of the grant", async () => {
    const { clientId, tokens } = await connect();
    const grants = (await alice.get("/api/me/tokens")).body.filter((x: { prefix: string }) => x.prefix === "oauth");
    for (const g of grants) expect((await alice.del(`/api/me/tokens/${g.id}`)).status).toBe(200);
    expect((await mcp(tokens.access_token)).statusCode).toBe(401);
    expect((await form("/oauth/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId })).json().error).toBe("invalid_grant");
  });

  it("by revoking the refresh token (RFC 7009)", async () => {
    const { tokens } = await connect();
    expect((await form("/oauth/revoke", { token: tokens.refresh_token })).statusCode).toBe(200);
    expect((await mcp(tokens.access_token)).statusCode).toBe(401);
  });
});

describe("clients known by their metadata document (CIMD)", () => {
  it("are fetched, checked and shown by their URL", async () => {
    metadataDoc = (url) => ({ client_id: url, client_name: "Doc client", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
    const clientId = `${metadataBase}/client.json`;
    const a = await authorize(clientId);
    expect(a.location).toMatch(/\/oauth\/consent\?request=/);
    expect((await alice.get(`/api/oauth/requests/${a.request}`)).body.client).toMatchObject({ name: "Doc client", url: clientId });
  });

  it("are never fetched from the token endpoint, which anyone can call", async () => {
    let hits = 0;
    metadataDoc = (url) => {
      hits++;
      return { client_id: url, client_name: "Doc", redirect_uris: [CALLBACK] };
    };
    const res = await form("/oauth/token", { grant_type: "authorization_code", code: "x", client_id: `${metadataBase}/never-seen.json`, code_verifier: pkce().verifier });
    expect(res.json().error).toBe("invalid_client");
    expect(hits).toBe(0);
  });

  it("are refused when the document names another client, or other redirect URIs", async () => {
    metadataDoc = () => ({ client_id: "https://someone.else/client.json", client_name: "X", redirect_uris: [CALLBACK] });
    expect((await authorize(`${metadataBase}/liar.json`)).res.statusCode).toBe(400);
    metadataDoc = (url) => ({ client_id: url, client_name: "X", redirect_uris: ["https://other.example/cb"] });
    expect((await authorize(`${metadataBase}/other.json`)).res.statusCode).toBe(400);
  });
});
