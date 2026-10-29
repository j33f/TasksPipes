/**
 * Company sign-in with OpenID Connect (any provider: Keycloak, Okta, Entra ID, Google Workspace…), for accounts without
 * Outline. Authorization code flow with PKCE (S256); state, nonce and verifier ride in an encrypted cookie for ten
 * minutes. The ID token is checked against the provider's keys (JWKS, RS256 or ES256), its issuer, audience, expiry
 * and nonce. An account is the provider's person (issuer + sub); an e-mail account with the same address is linked
 * to it only when the provider vouches for the address (email_verified). OIDC_ALLOWED_DOMAINS limits the addresses.
 */
import crypto, { type JsonWebKey } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { one, tx } from "./db.js";
import { ensurePersonalSpace, loginError, reenableInvited, signInAccount, startFlow, takeFlow } from "./auth.js";
import { localeOf, tr } from "./i18n.js";
import { LIMITS, rateLimited } from "./rate-limit.js";

const FLOW_COOKIE = "tp_oidc";
const b64u = (b: Buffer) => b.toString("base64url");
const redirectUri = () => `${config.appUrl}/auth/oidc/callback`;

export class OidcError extends Error {}

// ---------------------------------------------------------------------------
// The provider: its configuration and keys, kept for an hour

interface Provider {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

/** Seam for the tests: how the provider is reached. */
export const oidcTransport = { fetch: (url: string, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) };

let provider: { value: Provider; at: number } | null = null;
let jwks: { keys: JsonWebKey[]; at: number } | null = null;
const HOUR = 3_600_000;

export function resetOidcCache() {
  provider = null;
  jwks = null;
}

async function getJson(url: string, init?: RequestInit) {
  const res = await oidcTransport.fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || typeof body !== "object") throw new OidcError(`The identity provider answered ${res.status}`);
  return body as Record<string, unknown>;
}

export async function discover(): Promise<Provider> {
  if (provider && Date.now() - provider.at < HOUR) return provider.value;
  const d = await getJson(`${config.oidc.issuer}/.well-known/openid-configuration`);
  // The configuration must be the issuer's own.
  if (String(d.issuer ?? "").replace(/\/+$/, "") !== config.oidc.issuer) throw new OidcError("The identity provider's issuer does not match OIDC_ISSUER");
  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    if (typeof d[k] !== "string" || !/^https?:\/\//.test(d[k] as string)) throw new OidcError(`The identity provider has no ${k}`);
  }
  provider = { value: d as unknown as Provider, at: Date.now() };
  return provider.value;
}

async function keys(refresh = false): Promise<JsonWebKey[]> {
  if (!refresh && jwks && Date.now() - jwks.at < HOUR) return jwks.keys;
  const d = await getJson((await discover()).jwks_uri);
  jwks = { keys: Array.isArray(d.keys) ? (d.keys as JsonWebKey[]) : [], at: Date.now() };
  return jwks.keys;
}

// ---------------------------------------------------------------------------
// The ID token

export interface IdClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  nonce?: string;
}

const ALGS: Record<string, { hash: string; kty: string; dsaEncoding?: "ieee-p1363" }> = {
  RS256: { hash: "sha256", kty: "RSA" },
  ES256: { hash: "sha256", kty: "EC", dsaEncoding: "ieee-p1363" },
};

/** Checks an ID token's signature (the provider's keys) and claims; returns them. */
export async function verifyIdToken(token: string, nonce: string, now = Date.now()): Promise<IdClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new OidcError("Invalid ID token");
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    throw new OidcError("Invalid ID token");
  }
  const alg = ALGS[header.alg ?? ""];
  if (!alg) throw new OidcError("Unsupported ID token algorithm");
  const pick = (list: JsonWebKey[]) => list.find((k) => k.kty === alg.kty && (!header.kid || (k as { kid?: string }).kid === header.kid));
  // A key not known yet: the provider may have rotated its keys.
  const jwk = pick(await keys()) ?? pick(await keys(true));
  if (!jwk) throw new OidcError("Unknown ID token key");
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const ok = crypto.verify(alg.hash, Buffer.from(`${parts[0]}.${parts[1]}`), alg.dsaEncoding ? { key, dsaEncoding: alg.dsaEncoding } : key, Buffer.from(parts[2], "base64url"));
  if (!ok) throw new OidcError("Invalid ID token signature");

  const p = await discover();
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const skew = 60;
  const t = Math.floor(now / 1000);
  if (claims.iss !== p.issuer) throw new OidcError("ID token from another issuer");
  if (!aud.includes(config.oidc.clientId) || (aud.length > 1 && claims.azp !== config.oidc.clientId)) throw new OidcError("ID token for another client");
  if (typeof claims.exp !== "number" || claims.exp + skew < t) throw new OidcError("Expired ID token");
  if (typeof claims.iat === "number" && claims.iat - skew > t) throw new OidcError("ID token from the future");
  if (claims.nonce !== nonce) throw new OidcError("Invalid ID token nonce");
  if (typeof claims.sub !== "string" || !claims.sub) throw new OidcError("ID token without subject");
  return claims as unknown as IdClaims;
}

// ---------------------------------------------------------------------------
// Accounts

/** Whether an address may sign in (OIDC_ALLOWED_DOMAINS, when set). */
export const domainAllowed = (email: string | undefined) =>
  !config.oidc.allowedDomains.length || Boolean(email && config.oidc.allowedDomains.includes(email.toLowerCase().split("@")[1] ?? ""));

/**
 * The account of the provider's person: already known, else the e-mail account with the address the provider
 * vouches for (linked to it), else a new one. Returns its id, and whether it is disabled.
 */
export async function oidcAccount(c: IdClaims, lang: ReturnType<typeof localeOf>) {
  const issuer = config.oidc.issuer;
  const email = typeof c.email === "string" && c.email.includes("@") ? c.email.trim().toLowerCase().slice(0, 320) : null;
  const verified = c.email_verified === true && Boolean(email);
  const name = String(c.name || c.preferred_username || email || "").trim().slice(0, 200) || tr(lang, "Unnamed");
  return tx(async (db) => {
    let u = await one(`SELECT id, disabled_at FROM users WHERE oidc_issuer = $1 AND oidc_sub = $2`, [issuer, c.sub], db);
    if (u) {
      await db.query(`UPDATE users SET oidc_email_verified = $2, email = COALESCE($3, email) WHERE id = $1 AND auth_kind = 'oidc'`, [u.id, verified, verified ? email : null]);
      return { id: u.id as string, disabled: Boolean(u.disabled_at) };
    }
    if (verified) {
      u = await one(`SELECT id, disabled_at, disabled_reason FROM users WHERE auth_kind = 'email' AND lower(email) = $1 AND oidc_sub IS NULL`, [email], db);
      if (u) {
        await db.query(`UPDATE users SET oidc_issuer = $2, oidc_sub = $3, oidc_email_verified = true WHERE id = $1`, [u.id, issuer, c.sub]);
        // An invitation never taken up: the provider proved the address, as its link would have.
        if (u.disabled_reason === "unused_invitation") {
          await reenableInvited(u.id, db);
          return { id: u.id as string, disabled: false };
        }
        return { id: u.id as string, disabled: Boolean(u.disabled_at) };
      }
    }
    const created = await one(
      `INSERT INTO users (id, name, email, auth_kind, oidc_issuer, oidc_sub, oidc_email_verified) VALUES (gen_uuidv7(), $1, $2, 'oidc', $3, $4, $5) RETURNING id`,
      [name, email, issuer, c.sub, verified],
      db
    );
    await ensurePersonalSpace(db, created!.id, lang);
    return { id: created!.id as string, disabled: false };
  });
}

// ---------------------------------------------------------------------------
// Routes

export async function oidcRoutes(app: FastifyInstance) {
  app.get("/auth/oidc", rateLimited(LIMITS.oidc), async (req, reply) => {
    if (!config.oidc.enabled) return loginError(reply, tr(localeOf(req), "Not found"));
    const p = await discover();
    const flow = { nonce: b64u(crypto.randomBytes(16)), verifier: b64u(crypto.randomBytes(32)) };
    const state = startFlow(req, reply, FLOW_COOKIE, flow);
    const url = new URL(p.authorization_endpoint);
    for (const [k, v] of Object.entries({
      response_type: "code", client_id: config.oidc.clientId, redirect_uri: redirectUri(), scope: config.oidc.scopes,
      state, nonce: flow.nonce, code_challenge: b64u(crypto.createHash("sha256").update(flow.verifier).digest()), code_challenge_method: "S256",
    })) url.searchParams.set(k, v);
    return reply.redirect(url.toString());
  });

  type Callback = FastifyRequest<{ Querystring: Record<string, string | undefined> }>;
  app.get("/auth/oidc/callback", rateLimited(LIMITS.oidc), async (req: Callback, reply: FastifyReply) => {
    const lang = localeOf(req);
    const fail = (msg: string) => loginError(reply, msg);
    if (!config.oidc.enabled) return fail(tr(lang, "Not found"));
    try {
      const flow = takeFlow<{ nonce: string; verifier: string }>(req, reply, FLOW_COOKIE, req.query.state);
      if (req.query.error) return fail(tr(lang, "Sign-in failed"));
      if (!flow || !req.query.code) {
        // Already signed in: this return was played again (back button, a second tab); nothing to do.
        if (req.user) return reply.redirect("/");
        return fail(tr(lang, "Sign-in expired or interrupted, please try again."));
      }
      const p = await discover();
      const tokens = await getJson(p.token_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.oidc.clientId)}:${encodeURIComponent(config.oidc.clientSecret)}`).toString("base64")}`,
        },
        body: new URLSearchParams({ grant_type: "authorization_code", code: req.query.code, redirect_uri: redirectUri(), code_verifier: flow.verifier }).toString(),
      });
      if (typeof tokens.id_token !== "string") throw new OidcError("No ID token");
      const claims = await verifyIdToken(tokens.id_token, flow.nonce);
      if (!domainAllowed(claims.email)) return fail(tr(lang, "This account may not sign in here."));
      const account = await oidcAccount(claims, lang);
      if (account.disabled) return fail(tr(lang, "Sign-in failed"));
      const step = await signInAccount(reply, account.id);
      req.log.info({ userId: account.id }, "User logged in with OpenID Connect");
      return reply.redirect(step === "totp" ? "/magic?totp=1" : "/");
    } catch (err) {
      // The cause goes to the logs, never a token.
      req.log.error({ err: err instanceof OidcError ? err.message : err }, "OpenID Connect sign-in failed");
      return fail(tr(lang, "Sign-in failed"));
    }
  });
}
