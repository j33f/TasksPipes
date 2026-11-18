/**
 * OAuth 2.1 for remote MCP clients (claude.ai connectors, Claude Desktop, other MCP clients): TasksPipes is both the
 * MCP resource server (/mcp, mcp.ts) and its authorization server. Deliberately small:
 * - public clients only (no client secret): the authorization code grant with PKCE (S256), and refresh tokens, rotated;
 * - clients known by their metadata document's URL (CIMD) or registered on the fly (DCR, RFC 7591);
 * - opaque tokens, kept hashed, for the /mcp resource only (RFC 8707); access tokens last an hour;
 * - redirect URIs matched exactly, but for the port of a loopback one (RFC 8252), as native clients need.
 * What a person consents to (Settings-like choice of scopes and spaces) is a grant: an agent row of api_tokens, so that
 * scopes, spaces, "via" in the history and disconnecting work as for agent tokens. Off with AI agents (MCP_ENABLED).
 * Discovery: protected resource metadata (RFC 9728), authorization server metadata (RFC 8414).
 */
import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { one, query, tx } from "./db.js";
import { MCP_SCOPES, agentChoice, type McpScope } from "./api.js";
import { bad, forbidden, notFound } from "./errors.js";
import { rateLimited } from "./rate-limit.js";
import { getText, guardedLookup } from "./net.js";

const MIN = 60_000;
const ACCESS_TOKEN_SECONDS = 3600;
/** A refresh token unused this long dies; each use gives a new one, for as long again. */
const REFRESH_TOKEN_DAYS = 90;
const CODE_SECONDS = 300;
const REQUEST_MINUTES = 10;
/** A client's metadata document is fetched again after this. */
const CIMD_CACHE = "24 hours";
/** A refresh token used twice within this delay is a client retrying, not a stolen token: refused, not punished. */
const REFRESH_RACE_SECONDS = 10;

const hash = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const secret = (prefix: string) => `${prefix}${crypto.randomBytes(32).toString("base64url")}`;
const REFRESH_TOKEN = /^tpr_[A-Za-z0-9_-]{43}$/;

export const issuer = () => config.appUrl;
/** The resource tokens are issued for: the MCP endpoint, as clients name it. */
export const mcpResource = () => `${config.appUrl}/mcp`;
/** Where clients learn how to get a token for /mcp (in the 401 challenge). */
export const resourceMetadataUrl = () => `${config.appUrl}/.well-known/oauth-protected-resource/mcp`;
const sameResource = (r: string) => r.replace(/\/+$/, "") === mcpResource();

// ---- Clients ------------------------------------------------------------------------------------------------------

interface Client {
  id: string;
  clientId: string;
  kind: "dcr" | "cimd";
  name: string;
  redirectUris: string[];
}

const isLoopback = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/** A redirect URI a client may register: https, or http on this machine (native apps); no fragment, no credentials. */
function validRedirect(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  return u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u.hostname));
}

/** Whether `asked` is one of the registered URIs: exactly, or a loopback one whatever its port (RFC 8252 §7.3). */
export function redirectMatches(registered: string[], asked: string): boolean {
  if (registered.includes(asked)) return true;
  let a: URL;
  try {
    a = new URL(asked);
  } catch {
    return false;
  }
  if (a.protocol !== "http:" || !isLoopback(a.hostname) || a.hash || a.username || a.password) return false;
  return registered.some((r) => {
    try {
      const x = new URL(r);
      return x.protocol === "http:" && x.hostname === a.hostname && x.pathname === a.pathname && x.search === a.search;
    } catch {
      return false;
    }
  });
}

/**
 * The name a client gives itself, shown on the consent screen: never the instance's own name, which would make an
 * unknown client look like part of TasksPipes.
 */
function clientName(asked: unknown, fallback: string) {
  const name = typeof asked === "string" ? asked.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 100) : "";
  if (!name || /tasks\s*-?\s*pipes/i.test(name)) return fallback;
  return name;
}

const toClient = (r: Record<string, unknown>): Client => ({
  id: r.id as string, clientId: r.client_id as string, kind: r.kind as Client["kind"], name: r.name as string,
  redirectUris: r.redirect_uris as string[],
});

/** A client id that is a metadata document's URL (CIMD): https with a path (http too where internal addresses are allowed, for tests). */
function metadataUrl(clientId: string): URL | null {
  try {
    const u = new URL(clientId);
    const scheme = u.protocol === "https:" || (config.webhookAllowPrivate && u.protocol === "http:");
    return scheme && u.pathname.length > 1 && !u.hash && !u.username && !u.password && clientId.length <= 2000 ? u : null;
  } catch {
    return null;
  }
}

/**
 * The client a client_id names. A metadata document (a URL) is fetched only when `fetch` is set — at the authorization
 * request, the start of a connection — and then again once a day; elsewhere (the token endpoint, which anyone can
 * call) the client must be known already, so that nobody can make the server fetch documents and store clients at
 * will. Should a fetch fail, what was fetched before keeps working.
 */
async function findClient(clientId: unknown, fetch = false): Promise<Client | null> {
  if (typeof clientId !== "string" || !clientId) return null;
  if (!metadataUrl(clientId)) {
    const row = await one(`SELECT * FROM oauth_clients WHERE client_id = $1 AND kind = 'dcr'`, [clientId]);
    return row ? toClient(row) : null;
  }
  const known = await one(
    `SELECT *, fetched_at > now() - interval '${CIMD_CACHE}' AS fresh FROM oauth_clients WHERE client_id = $1 AND kind = 'cimd'`,
    [clientId]
  );
  if (known && (known.fresh || !fetch)) return toClient(known);
  if (!fetch) return null;
  const fetched = await fetchMetadata(clientId);
  return fetched ?? (known ? toClient(known) : null);
}

/** A client's metadata document, checked and stored; null when it cannot be had or is not right. */
async function fetchMetadata(clientId: string): Promise<Client | null> {
  try {
    // Never an internal address (SSRF), no redirect followed, a small answer, quickly.
    const res = await getText(clientId, { accept: "application/json" }, guardedLookup(config.webhookAllowPrivate), {
      timeoutMs: 5000, maxResponse: 20_000,
    });
    if (res.status !== 200) return null;
    const doc = JSON.parse(res.text);
    if (!doc || typeof doc !== "object" || doc.client_id !== clientId) return null;
    const uris = doc.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 20 || !uris.every(validRedirect)) return null;
    if (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== "none") return null;
    const name = clientName(doc.client_name, new URL(clientId).hostname);
    const row = await one(
      `INSERT INTO oauth_clients (client_id, kind, name, redirect_uris, fetched_at) VALUES ($1, 'cimd', $2, $3, now())
       ON CONFLICT (client_id) DO UPDATE SET name = EXCLUDED.name, redirect_uris = EXCLUDED.redirect_uris, fetched_at = now()
       WHERE oauth_clients.kind = 'cimd'
       RETURNING *`,
      [clientId, name, uris]
    );
    return row ? toClient(row) : null;
  } catch {
    return null;
  }
}

// ---- Grants and tokens --------------------------------------------------------------------------------------------

/** Disconnects a grant (a refresh token used twice, a code used twice): every token of it dies with it. */
async function revokeGrant(grantId: string) {
  await query(`UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [grantId]);
  await query(`DELETE FROM oauth_tokens WHERE grant_id = $1`, [grantId]);
}

/** A grant still in force: not disconnected, its owner's account enabled. */
const liveGrant = async (grantId: string) =>
  one(
    `SELECT t.id, t.scopes FROM api_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.id = $1 AND t.kind = 'agent' AND t.revoked_at IS NULL AND u.disabled_at IS NULL`,
    [grantId]
  );

async function issueTokens(grantId: string, scopes: McpScope[]) {
  const access = secret("tpo_");
  const refresh = secret("tpr_");
  await query(
    `INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at) VALUES
       ($1, $3, 'access', now() + make_interval(secs => $4)), ($2, $3, 'refresh', now() + make_interval(days => $5))`,
    [hash(access), hash(refresh), grantId, ACCESS_TOKEN_SECONDS, REFRESH_TOKEN_DAYS]
  );
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_SECONDS, refresh_token: refresh, scope: scopes.join(" ") };
}

/** `uri` with these query parameters added (empty ones left out). */
function withParams(uri: string, params: Record<string, string | undefined | null>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

const pkceMatches = (verifier: string, challenge: string) => {
  const computed = Buffer.from(crypto.createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
};

/** Removes what is no longer of use: hourly. */
export async function cleanupOAuth() {
  await query(`DELETE FROM oauth_requests WHERE created_at < now() - interval '1 hour'`);
  await query(`DELETE FROM oauth_codes WHERE expires_at < now() - interval '1 hour'`);
  await query(`DELETE FROM oauth_tokens WHERE expires_at < now() OR used_at < now() - interval '1 day'`);
  // Clients of connections never completed. Those that had a grant stay, disconnected or not: the history shows
  // what was done via them.
  await query(
    `DELETE FROM oauth_clients c WHERE c.created_at < now() - interval '1 hour'
     AND NOT EXISTS (SELECT 1 FROM api_tokens t WHERE t.oauth_client_id = c.id)`
  );
}

// ---- Routes -------------------------------------------------------------------------------------------------------

export async function oauthRoutes(app: FastifyInstance) {
  /** Everything here answers 404 while AI agents are off. */
  const enabled = async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!config.mcpEnabled) return reply.code(404).send({ error: "Not found" });
  };

  // Discovery. The protected resource metadata, at the path clients derive from /mcp and at the root.
  const resourceMetadata = async () => ({
    resource: mcpResource(),
    authorization_servers: [issuer()],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "TasksPipes",
  });
  app.get("/.well-known/oauth-protected-resource/mcp", { preHandler: enabled }, resourceMetadata);
  app.get("/.well-known/oauth-protected-resource", { preHandler: enabled }, resourceMetadata);

  const serverMetadata = async () => ({
    issuer: issuer(),
    authorization_endpoint: `${issuer()}/oauth/authorize`,
    token_endpoint: `${issuer()}/oauth/token`,
    registration_endpoint: `${issuer()}/oauth/register`,
    revocation_endpoint: `${issuer()}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  });
  app.get("/.well-known/oauth-authorization-server", { preHandler: enabled }, serverMetadata);
  // An issuer with a path (APP_URL under a sub-path) is looked up with that path appended.
  const issuerPath = new URL(config.appUrl).pathname.replace(/\/+$/, "");
  if (issuerPath) app.get(`/.well-known/oauth-authorization-server${issuerPath}`, { preHandler: enabled }, serverMetadata);

  // Dynamic client registration: public clients only, redirect URIs in https or on the client's machine.
  type Registration = { client_name?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown; grant_types?: unknown; response_types?: unknown };
  app.post<{ Body: Registration }>(
    "/oauth/register",
    { preHandler: enabled, ...rateLimited({ name: "oauth-register", max: 30, timeWindow: 60 * MIN }) },
    async (req, reply) => {
      const b = req.body && typeof req.body === "object" ? req.body : {};
      const invalid = (description: string) => reply.code(400).send({ error: "invalid_client_metadata", error_description: description });
      const uris = b.redirect_uris;
      if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(validRedirect)) {
        return reply.code(400).send({ error: "invalid_redirect_uri", error_description: "redirect_uris: https, or http on localhost" });
      }
      if (b.token_endpoint_auth_method !== undefined && b.token_endpoint_auth_method !== "none") return invalid("Only public clients (none)");
      const grants = Array.isArray(b.grant_types) ? b.grant_types : ["authorization_code", "refresh_token"];
      if (!grants.every((g) => g === "authorization_code" || g === "refresh_token")) return invalid("grant_types: authorization_code, refresh_token");
      const responses = Array.isArray(b.response_types) ? b.response_types : ["code"];
      if (!responses.every((r) => r === "code")) return invalid("response_types: code");
      const name = clientName(b.client_name, "MCP client");
      const clientId = `tpc_${crypto.randomBytes(18).toString("base64url")}`;
      const row = await one(
        `INSERT INTO oauth_clients (client_id, kind, name, redirect_uris) VALUES ($1, 'dcr', $2, $3) RETURNING created_at`,
        [clientId, name, uris]
      );
      req.log.info({ clientId, name }, "OAuth client registered");
      return reply.code(201).send({
        client_id: clientId, client_id_issued_at: Math.floor(new Date(row!.created_at).getTime() / 1000), client_name: name,
        redirect_uris: uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      });
    }
  );

  // The authorization request: checked, then kept for the person to consent to, in the app (/oauth/consent).
  type Authorize = Record<string, string | undefined>;
  app.get<{ Querystring: Authorize }>(
    "/oauth/authorize",
    { preHandler: enabled, ...rateLimited({ name: "oauth-authorize", max: 60, timeWindow: MIN }) },
    async (req, reply) => {
      const q = req.query ?? {};
      const client = await findClient(q.client_id, true);
      // Without a known client and one of its redirect URIs, nothing is sent back to the client: an error is shown.
      // The redirect URI is always asked for (OAuth 2.1 allows it), and compared again at the token endpoint.
      if (!client) throw bad("This application is unknown: connect it again from where you started");
      const redirect = q.redirect_uri;
      if (!redirect || !redirectMatches(client.redirectUris, redirect)) throw bad("This application gave a return address it did not register");
      const state = typeof q.state === "string" ? q.state.slice(0, 1000) : undefined;
      const back = (error: string, description?: string) =>
        reply.redirect(withParams(redirect, { error, error_description: description, state, iss: issuer() }));
      if (q.response_type !== "code") return back("unsupported_response_type");
      if (q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge ?? "")) {
        return back("invalid_request", "PKCE with S256 is required");
      }
      if (q.resource && !sameResource(q.resource)) return back("invalid_target", `Tokens are issued for ${mcpResource()}`);
      const asked = String(q.scope ?? "").split(/\s+/).filter((s): s is McpScope => (MCP_SCOPES as readonly string[]).includes(s));
      const id = crypto.randomBytes(32).toString("base64url");
      await query(
        `INSERT INTO oauth_requests (id, client_id, redirect_uri, state, code_challenge, scopes) VALUES ($1, $2, $3, $4, $5, $6)`,
        [hash(id), client.id, redirect, state ?? null, q.code_challenge, asked]
      );
      return reply.redirect(`${config.appUrl}/oauth/consent?request=${id}`);
    }
  );

  /** A pending request, while it is fresh. */
  const pending = (id: string) =>
    one(
      `SELECT r.*, c.name AS client_name, c.kind AS client_kind, c.client_id AS client_ref
       FROM oauth_requests r JOIN oauth_clients c ON c.id = r.client_id
       WHERE r.id = $1 AND r.created_at > now() - make_interval(mins => $2)`,
      [hash(String(id)), REQUEST_MINUTES]
    );

  // Consent, from the app (a signed-in session): what asks, where it will send the answer, what it asks for.
  app.get<{ Params: { id: string } }>("/api/oauth/requests/:id", { preHandler: enabled }, async (req) => {
    if (!req.user || req.apiToken) throw forbidden("Sign in to TasksPipes first");
    const r = await pending(req.params.id);
    if (!r) throw notFound("This request has expired: connect the application again");
    return {
      // A registered client (DCR) is whoever registered it: its name is unverified. A metadata document is at least
      // served by the host of its URL.
      client: {
        name: r.client_name, verified: r.client_kind === "cimd", url: r.client_kind === "cimd" ? r.client_ref : null,
        redirectHost: new URL(r.redirect_uri).host,
      },
      scopes: r.scopes,
    };
  });

  app.post<{ Params: { id: string }; Body: { scopes?: unknown; spaceIds?: unknown } }>(
    "/api/oauth/requests/:id/approve",
    { preHandler: enabled },
    async (req) => {
      if (!req.user || req.apiToken) throw forbidden("Sign in to TasksPipes first");
      const choice = await agentChoice(req.user.id, req.body?.scopes, req.body?.spaceIds);
      const code = crypto.randomBytes(32).toString("base64url");
      const r = await tx(async (db) => {
        // Taken once: a second approval of the same request finds nothing.
        const { rows } = await db.query(
          `DELETE FROM oauth_requests r USING oauth_clients c
           WHERE r.id = $1 AND c.id = r.client_id AND r.created_at > now() - make_interval(mins => $2)
           RETURNING r.*, c.name AS client_name`,
          [hash(req.params.id), REQUEST_MINUTES]
        );
        const request = rows[0];
        if (!request) throw notFound("This request has expired: connect the application again");
        const grant = await db.query(
          `INSERT INTO api_tokens (user_id, name, token_hash, prefix, scope, kind, scopes, space_ids, expires_at, oauth_client_id)
           VALUES ($1, $2, $3, 'oauth', $4, 'agent', $5, $6, NULL, $7) RETURNING id`,
          // The grant has no usable token of its own: a hash of something nobody keeps.
          [req.user!.id, request.client_name, hash(crypto.randomBytes(32).toString("hex")), choice.scope, choice.scopes, choice.spaceIds, request.client_id]
        );
        await db.query(
          `INSERT INTO oauth_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
          [hash(code), grant.rows[0].id, request.client_id, request.redirect_uri, request.code_challenge, CODE_SECONDS]
        );
        return request;
      });
      req.log.info({ client: r.client_name, scopes: choice.scopes }, "OAuth access granted");
      return { redirect: withParams(r.redirect_uri, { code, state: r.state, iss: issuer() }) };
    }
  );

  app.post<{ Params: { id: string } }>("/api/oauth/requests/:id/deny", { preHandler: enabled }, async (req) => {
    if (!req.user || req.apiToken) throw forbidden("Sign in to TasksPipes first");
    const r = await one(`DELETE FROM oauth_requests WHERE id = $1 RETURNING redirect_uri, state`, [hash(req.params.id)]);
    if (!r) throw notFound("This request has expired: connect the application again");
    return { redirect: withParams(r.redirect_uri, { error: "access_denied", state: r.state, iss: issuer() }) };
  });

  // The token and revocation endpoints take forms (application/x-www-form-urlencoded), as OAuth requires.
  await app.register(async (forms) => {
    forms.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 16 * 1024 }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    });

    forms.post<{ Body: Record<string, string | undefined> }>(
      "/oauth/token",
      { preHandler: enabled, ...rateLimited({ name: "oauth-token", max: 120, timeWindow: MIN }) },
      async (req, reply) => {
        reply.header("cache-control", "no-store").header("pragma", "no-cache");
        const b = req.body && typeof req.body === "object" ? req.body : {};
        const fail = (status: number, error: string, description?: string) =>
          reply.code(status).send({ error, ...(description ? { error_description: description } : {}) });
        const client = await findClient(b.client_id);
        if (!client) return fail(401, "invalid_client");
        if (b.resource && !sameResource(b.resource)) return fail(400, "invalid_target");
        let grantId: string;
        if (b.grant_type === "authorization_code") {
          if (!/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier ?? "")) return fail(400, "invalid_request", "code_verifier");
          const code = hash(String(b.code ?? ""));
          const row = await one(`UPDATE oauth_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL RETURNING *`, [code]);
          if (!row) {
            // A code used twice: whoever has it may not be the client; what it gave is taken back (RFC 6749 §4.1.2).
            const used = await one(`SELECT grant_id FROM oauth_codes WHERE code_hash = $1`, [code]);
            if (used) await revokeGrant(used.grant_id);
            return fail(400, "invalid_grant");
          }
          if (new Date(row.expires_at) < new Date() || row.client_id !== client.id || row.redirect_uri !== b.redirect_uri) {
            return fail(400, "invalid_grant");
          }
          if (!pkceMatches(String(b.code_verifier), row.code_challenge)) return fail(400, "invalid_grant", "code_verifier");
          grantId = row.grant_id;
        } else if (b.grant_type === "refresh_token") {
          const token = String(b.refresh_token ?? "");
          if (!REFRESH_TOKEN.test(token)) return fail(400, "invalid_grant");
          const row = await one(
            `UPDATE oauth_tokens o SET used_at = now() FROM api_tokens t
             WHERE o.token_hash = $1 AND o.kind = 'refresh' AND o.used_at IS NULL AND o.expires_at > now()
               AND t.id = o.grant_id AND t.oauth_client_id = $2
             RETURNING o.grant_id`,
            [hash(token), client.id]
          );
          if (!row) {
            // Used before: a stolen token being replayed, unless the client just retried (refreshing twice at once).
            const used = await one(
              `SELECT grant_id, used_at > now() - make_interval(secs => $2) AS racing FROM oauth_tokens
               WHERE token_hash = $1 AND kind = 'refresh' AND used_at IS NOT NULL`,
              [hash(token), REFRESH_RACE_SECONDS]
            );
            if (used && !used.racing) await revokeGrant(used.grant_id);
            return fail(400, "invalid_grant");
          }
          grantId = row.grant_id;
        } else {
          return fail(400, "unsupported_grant_type");
        }
        const grant = await liveGrant(grantId);
        if (!grant) return fail(400, "invalid_grant");
        await query(`UPDATE oauth_clients SET last_used_at = now() WHERE id = $1`, [client.id]);
        return issueTokens(grant.id, grant.scopes);
      }
    );

    // Revocation (RFC 7009): always 200. A refresh token takes its grant with it; an access token only itself.
    forms.post<{ Body: Record<string, string | undefined> }>(
      "/oauth/revoke",
      { preHandler: enabled, ...rateLimited({ name: "oauth-revoke", max: 60, timeWindow: MIN }) },
      async (req, reply) => {
        const token = String(req.body?.token ?? "");
        const row = await one(`SELECT grant_id, kind FROM oauth_tokens WHERE token_hash = $1`, [hash(token)]);
        if (row?.kind === "refresh") await revokeGrant(row.grant_id);
        else if (row) await query(`DELETE FROM oauth_tokens WHERE token_hash = $1`, [hash(token)]);
        return reply.code(200).send({});
      }
    );
  });
}
