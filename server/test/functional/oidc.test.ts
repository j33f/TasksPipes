import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { agent, signIn, signInWithLink, startApp, stopApp, type Agent } from "./helpers.js";
import { config } from "../../src/config.js";
import { pool } from "../../src/db.js";
import { encrypt } from "../../src/auth.js";
import { oidcTransport, resetOidcCache } from "../../src/oidc.js";

const ISSUER = "https://idp.test/realms/acme";
const key = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
let app: FastifyInstance, bob: Agent;
let tokenRequests: { headers: Headers; body: URLSearchParams }[];
let nextClaims: Record<string, unknown>;

const b64u = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims: object) => {
  const head = b64u({ alg: "RS256", kid: "k1" });
  const body = b64u(claims);
  return `${head}.${body}.${crypto.sign("sha256", Buffer.from(`${head}.${body}`), key.privateKey).toString("base64url")}`;
};

/** Goes through the provider: start, then come back with a code; the provider vouches for `claims`. */
async function viaProvider(claims: Record<string, unknown>, tamper: { state?: string; noCookie?: boolean } = {}) {
  const start = await app.inject({ method: "GET", url: "/auth/oidc" });
  const to = new URL(start.headers.location as string);
  const flow = start.cookies.find((c) => c.name === "tp_oidc")!;
  nextClaims = { iss: ISSUER, aud: "tasks-pipes", exp: Math.floor(Date.now() / 1000) + 300, nonce: to.searchParams.get("nonce"), ...claims };
  const back = await app.inject({
    method: "GET",
    url: `/auth/oidc/callback?state=${tamper.state ?? to.searchParams.get("state")}&code=the-code`,
    headers: tamper.noCookie ? {} : { cookie: `tp_oidc=${flow.value}` },
  });
  const session = back.cookies.find((c) => c.name === "tp_session");
  return { start: to, location: back.headers.location as string, agent: session ? agent(`tp_session=${session.value}`) : null, cookies: back.cookies };
}

beforeAll(async () => {
  app = await startApp();
  bob = await signIn("bob-token");
  Object.assign(config.oidc, { issuer: ISSUER, clientId: "tasks-pipes", clientSecret: "client-secret", name: "Acme SSO", enabled: true, allowedDomains: [] });
  oidcTransport.fetch = async (url: string, init?: RequestInit) => {
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/certs` });
    }
    if (url.endsWith("/certs")) return Response.json({ keys: [{ ...key.publicKey.export({ format: "jwk" }), kid: "k1" }] });
    tokenRequests.push({ headers: new Headers(init?.headers), body: new URLSearchParams(String(init?.body)) });
    return Response.json({ access_token: "a", id_token: idToken(nextClaims) });
  };
  resetOidcCache();
});
beforeEach(() => {
  tokenRequests = [];
});
afterAll(async () => {
  config.oidc.enabled = false;
  await stopApp();
});

describe("company sign-in (OpenID Connect)", () => {
  it("is offered on the sign-in page", async () => {
    expect((await app.inject({ method: "GET", url: "/api/auth/config" })).json().oidc).toEqual({ name: "Acme SSO" });
  });

  it("creates an account on first sign-in, with PKCE, and finds it again", async () => {
    const first = await viaProvider({ sub: "acme-1", email: "dana@acme.test", email_verified: true, name: "Dana Acme" });
    expect(first.location).toBe("/");
    // PKCE: the verifier sent to the token endpoint matches the challenge sent to the provider.
    const { body, headers } = tokenRequests[0];
    expect(crypto.createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(first.start.searchParams.get("code_challenge"));
    expect(first.start.searchParams.get("code_challenge_method")).toBe("S256");
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from("tasks-pipes:client-secret").toString("base64")}`);
    const me = (await first.agent!.get("/api/me")).body;
    expect(me.user).toMatchObject({ name: "Dana Acme", email: "dana@acme.test", kind: "oidc" });
    expect(me.personalSpaceId).toBeTruthy();
    const again = await viaProvider({ sub: "acme-1", email: "dana@acme.test", email_verified: true });
    expect((await again.agent!.get("/api/me")).body.user.id).toBe(me.user.id);
  });

  it("links an e-mail account only when the provider vouches for the address", async () => {
    const guest = await signInWithLink((await bob.post("/api/invitations", { email: "eve@acme.test", name: "Eve" })).body.link);
    const guestId = (await guest.get("/api/me")).body.user.id;
    const unverified = await viaProvider({ sub: "acme-eve-unverified", email: "eve@acme.test", email_verified: false });
    expect((await unverified.agent!.get("/api/me")).body.user.id).not.toBe(guestId);
    const verified = await viaProvider({ sub: "acme-eve", email: "eve@acme.test", email_verified: true });
    expect((await verified.agent!.get("/api/me")).body.user).toMatchObject({ id: guestId, kind: "email" });
  });

  it("refuses a forged state, a missing flow, another domain, or a disabled account", async () => {
    for (const tamper of [{ state: "forged" }, { noCookie: true }]) {
      const r = await viaProvider({ sub: "acme-x", email: "x@acme.test", email_verified: true }, tamper);
      expect(r.agent).toBeNull();
      expect(r.location).toMatch(/^\/login\?error=/);
    }
    config.oidc.allowedDomains = ["acme.test"];
    const outsider = await viaProvider({ sub: "evil-1", email: "mallory@evil.test", email_verified: true });
    expect(outsider.agent).toBeNull();
    expect(decodeURIComponent(outsider.location)).toContain("This account may not sign in here.");
    config.oidc.allowedDomains = [];
    await pool.query(`UPDATE users SET disabled_at = now(), disabled_reason = 'admin' WHERE oidc_sub = 'acme-1'`);
    expect((await viaProvider({ sub: "acme-1", email: "dana@acme.test", email_verified: true })).agent).toBeNull();
    await pool.query(`UPDATE users SET disabled_at = NULL, disabled_reason = NULL WHERE oidc_sub = 'acme-1'`);
  });

  it("asks for the second factor of an account that has one", async () => {
    await pool.query(`UPDATE users SET totp_secret = $1 WHERE oidc_sub = 'acme-1'`, [encrypt("JBSWY3DPEHPK3PXP")]);
    const r = await viaProvider({ sub: "acme-1", email: "dana@acme.test", email_verified: true });
    expect(r.location).toBe("/magic?totp=1");
    expect(r.agent).toBeNull();
    expect(r.cookies.some((c) => c.name === "tp_2fa")).toBe(true);
  });

  it("is off when turned off", async () => {
    config.oidc.enabled = false;
    // Back on the sign-in page, not a bare error.
    expect((await app.inject({ method: "GET", url: "/auth/oidc" })).headers.location).toBe("/login?error=Not%20found");
    expect((await app.inject({ method: "GET", url: "/api/auth/config" })).json().oidc).toBeNull();
    config.oidc.enabled = true;
  });
});
