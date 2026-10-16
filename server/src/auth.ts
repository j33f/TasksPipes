import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CookieSerializeOptions } from "@fastify/cookie";
import fp from "fastify-plugin";
import { config } from "./config.js";
import { ensureDefaultPipes, one, query, tx, type Queryable, type Row } from "./db.js";
import { absoluteOutlineUrl, outlineApi, outlineToken, OutlineError, type OutlineUser } from "./outline.js";

const SESSION_COOKIE = "tp_session";
const STATE_COOKIE = "tp_oauth_state";
const key = crypto.createHash("sha256").update(config.appSecret).digest();

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
}

type OutlineCaller = <T = unknown>(method: string, body?: object) => Promise<{ data: T }>;

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
    outline: OutlineCaller;
  }
}

const hash = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

function encrypt(text: string | null | undefined): string | null {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

function decrypt(blob: string | null | undefined): string | null {
  if (!blob) return null;
  const buf = Buffer.from(blob, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

const cookieOptions = (maxAgeSeconds: number): CookieSerializeOptions => ({
  httpOnly: true,
  sameSite: "lax",
  secure: config.secureCookies,
  path: "/",
  maxAge: maxAgeSeconds,
});

/** Inserts or updates a user coming from Outline and makes sure they have a personal space. */
export async function upsertOutlineUser(db: Queryable, u: OutlineUser, { login = false } = {}) {
  await db.query(
    `INSERT INTO users (id, name, email, avatar_url, last_login_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $5::boolean THEN now() END)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       email = COALESCE(EXCLUDED.email, users.email),
       avatar_url = EXCLUDED.avatar_url,
       last_login_at = COALESCE(EXCLUDED.last_login_at, users.last_login_at),
       updated_at = now()`,
    [u.id, u.name || u.email || "Sans nom", u.email || null, absoluteOutlineUrl(u.avatarUrl), login]
  );
  const { rows } = await db.query(
    `INSERT INTO spaces (kind, user_id, created_by) VALUES ('user', $1, $1)
     ON CONFLICT (user_id) DO NOTHING RETURNING id`,
    [u.id]
  );
  if (rows[0]) {
    await db.query(
      `INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`,
      [rows[0].id, u.id]
    );
    await ensureDefaultPipes(db, rows[0].id);
  }
}

/** Imports every user of the Outline workspace so they can receive tasks before their first login. */
async function syncWorkspaceUsers(token: string) {
  const limit = 100;
  for (let offset = 0; offset < 10000; offset += limit) {
    const { data } = await outlineApi<OutlineUser[]>(token, "users.list", { limit, offset });
    if (!data?.length) break;
    await tx(async (client) => {
      for (const u of data) {
        if (!u.isSuspended) await upsertOutlineUser(client, u);
      }
    });
    if (data.length < limit) break;
  }
}

async function establishSession(
  req: FastifyRequest,
  reply: FastifyReply,
  tokens: { accessToken: string; refreshToken?: string | null; expiresIn?: number | null }
) {
  const { data } = await outlineApi<{ user: OutlineUser; team: { id: string } }>(tokens.accessToken, "auth.info");
  if (config.outlineTeamId && data.team?.id !== config.outlineTeamId) {
    throw new OutlineError(403, "Ce compte n'appartient pas à l'espace de travail Outline autorisé.");
  }
  await tx((client) => upsertOutlineUser(client, data.user, { login: true }));

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const maxAge = config.sessionDays * 24 * 3600;
  await query(
    `INSERT INTO sessions (id, user_id, access_token, refresh_token, token_expires_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      hash(sessionToken),
      data.user.id,
      encrypt(tokens.accessToken),
      encrypt(tokens.refreshToken),
      tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
      new Date(Date.now() + maxAge * 1000),
    ]
  );
  reply.setCookie(SESSION_COOKIE, sessionToken, cookieOptions(maxAge));
  req.log.info({ userId: data.user.id }, "User logged in");

  syncWorkspaceUsers(tokens.accessToken).catch((err) => req.log.warn({ err }, "Outline user sync failed"));
  return data.user;
}

async function refreshSessionToken(session: Row): Promise<string | null> {
  const refreshToken = decrypt(session.refresh_token);
  if (!refreshToken || !config.oauthEnabled) return null;
  const t = await outlineToken({ grant_type: "refresh_token", refresh_token: refreshToken });
  session.access_token = encrypt(t.access_token);
  session.refresh_token = encrypt(t.refresh_token || refreshToken);
  await query(`UPDATE sessions SET access_token = $2, refresh_token = $3, token_expires_at = $4 WHERE id = $1`, [
    session.id,
    session.access_token,
    session.refresh_token,
    t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
  ]);
  return t.access_token;
}

function outlineCallerFor(session: Row): OutlineCaller {
  return async (method, body) => {
    let token = decrypt(session.access_token)!;
    const expiresSoon = session.token_expires_at && new Date(session.token_expires_at).getTime() < Date.now() + 60_000;
    if (expiresSoon) token = (await refreshSessionToken(session)) || token;
    try {
      return await outlineApi(token, method, body);
    } catch (err) {
      if (err instanceof OutlineError && err.status === 401) {
        const fresh = await refreshSessionToken(session).catch(() => null);
        if (fresh) return outlineApi(fresh, method, body);
      }
      throw err;
    }
  };
}

const noOutline: OutlineCaller = async () => {
  throw new OutlineError(401, "Non authentifié");
};

async function auth(app: FastifyInstance) {
  app.decorateRequest("user", null);
  app.decorateRequest("outline", noOutline);

  // Loads the session (if any) on every request.
  app.addHook("onRequest", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await one(
      `SELECT s.*, u.name, u.email, u.avatar_url FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > now()`,
      [hash(token)]
    );
    if (!session) return;
    req.user = { id: session.user_id, name: session.name, email: session.email, avatarUrl: session.avatar_url };
    req.outline = outlineCallerFor(session);
  });

  app.get("/api/auth/config", async () => ({
    oauth: config.oauthEnabled,
    apiKey: config.allowApiKeyLogin,
    outlineUrl: config.outlineUrl,
  }));

  app.get("/auth/outline", async (_req, reply) => {
    if (!config.oauthEnabled) return reply.code(404).send("OAuth non configuré");
    const state = crypto.randomBytes(16).toString("hex");
    reply.setCookie(STATE_COOKIE, state, cookieOptions(600));
    const url = new URL(`${config.outlineUrl}/oauth/authorize`);
    url.searchParams.set("client_id", config.oauthClientId);
    url.searchParams.set("redirect_uri", `${config.appUrl}/auth/outline/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "read write");
    url.searchParams.set("state", state);
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: Record<string, string | undefined> }>("/auth/outline/callback", async (req, reply) => {
    const fail = (msg: string) => reply.redirect(`/login?error=${encodeURIComponent(msg)}`);
    try {
      if (req.query.error) return fail(req.query.error_description || req.query.error);
      const expected = req.cookies[STATE_COOKIE];
      reply.clearCookie(STATE_COOKIE, { path: "/" });
      if (!expected || expected !== req.query.state) return fail("État OAuth invalide, veuillez réessayer.");
      const t = await outlineToken({
        grant_type: "authorization_code",
        code: req.query.code || "",
        redirect_uri: `${config.appUrl}/auth/outline/callback`,
      });
      await establishSession(req, reply, {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresIn: t.expires_in,
      });
      return reply.redirect("/");
    } catch (err) {
      req.log.error({ err }, "OAuth callback failed");
      return fail((err as Error).message || "Connexion impossible");
    }
  });

  app.post<{ Body: { token?: string } }>("/api/auth/apikey", async (req, reply) => {
    if (!config.allowApiKeyLogin) return reply.code(404).send({ error: "Connexion par clé API désactivée" });
    const token = String(req.body?.token || "").trim();
    if (!token) return reply.code(400).send({ error: "Clé API requise" });
    try {
      const user = await establishSession(req, reply, { accessToken: token });
      return { user };
    } catch (err) {
      const status = err instanceof OutlineError && err.status < 500 ? 401 : 502;
      req.log.warn({ err }, "API key login failed");
      return reply.code(status).send({ error: status === 401 ? "Clé API Outline invalide" : (err as Error).message });
    }
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await query(`DELETE FROM sessions WHERE id = $1`, [hash(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}

/** Not encapsulated: the session hook and request decorators apply to every route. */
export const authPlugin = fp(auth, { name: "auth" });

export async function cleanupSessions() {
  await query(`DELETE FROM sessions WHERE expires_at < now()`);
}
