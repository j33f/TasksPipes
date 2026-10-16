import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CookieSerializeOptions } from "@fastify/cookie";
import fp from "fastify-plugin";
import { config } from "./config.js";
import { ensureDefaultPipes, one, query, tx, type Queryable, type Row } from "./db.js";
import { absoluteOutlineUrl, normalizeOutlineUrl, outlineApi, outlineToken, OutlineError, type OutlineUser } from "./outline.js";
import { mailEnabled, sendLinkMail } from "./mail.js";
import { verifyTotp } from "./totp.js";

const SESSION_COOKIE = "tp_session";
const STATE_COOKIE = "tp_oauth_state";
const TOTP_COOKIE = "tp_2fa";
/** Validity of a sign-in link: an invitation, or a link asked from the login page. */
export const INVITE_LINK_DAYS = 7;
const LOGIN_LINK_MINUTES = 20;
const key = crypto.createHash("sha256").update(config.appSecret).digest();

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  /** "outline": signs in with Outline; "email": invited by e-mail, signs in with e-mailed links. */
  kind: "outline" | "email";
  /** Second factor enabled (e-mail accounts). */
  totp: boolean;
}

type OutlineCaller = <T = unknown>(method: string, body?: object) => Promise<{ data: T }>;

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
    outline: OutlineCaller;
    /** Outline server of the session (the configured one for e-mail accounts). */
    outlineUrl: string;
  }
}

export const hash = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

export function encrypt(text: string | null | undefined): string | null {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(blob: string | null | undefined): string | null {
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
/**
 * Inserts or updates a user coming from an Outline server and makes sure they have a personal space.
 * Returns their internal id: the Outline id on the configured server, a new id on another one.
 */
export async function upsertOutlineUser(
  db: Queryable,
  u: OutlineUser,
  { login = false, instance = config.outlineUrl } = {}
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO users (id, name, email, avatar_url, last_login_at, outline_url, outline_id)
     VALUES (
       COALESCE((SELECT id FROM users WHERE outline_url = $5 AND outline_id = $6),
                CASE WHEN $7::boolean THEN $6::uuid ELSE gen_uuidv7() END),
       $1, $2, $3, CASE WHEN $4::boolean THEN now() END, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       email = COALESCE(EXCLUDED.email, users.email),
       avatar_url = EXCLUDED.avatar_url,
       last_login_at = COALESCE(EXCLUDED.last_login_at, users.last_login_at),
       updated_at = now()
     WHERE users.auth_kind = 'outline' AND users.outline_url = EXCLUDED.outline_url
     RETURNING id`,
    [u.name || u.email || "Sans nom", u.email || null, absoluteOutlineUrl(u.avatarUrl, instance), login,
     instance, u.id, instance === config.outlineUrl]
  );
  // No row: the id belongs to another kind of account, which is never taken over.
  if (!rows[0]) throw new OutlineError(403, "Compte incompatible");
  await ensurePersonalSpace(db, rows[0].id);
  return rows[0].id;
}

/** Gives a user their personal space (with its default pipe) if they have none yet. */
export async function ensurePersonalSpace(db: Queryable, userId: string) {
  const { rows } = await db.query(
    `INSERT INTO spaces (kind, user_id, created_by) VALUES ('user', $1, $1)
     ON CONFLICT (user_id) DO NOTHING RETURNING id`,
    [userId]
  );
  if (rows[0]) {
    await db.query(
      `INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`,
      [rows[0].id, userId]
    );
    await ensureDefaultPipes(db, rows[0].id);
  }
}

/** Opens a session; e-mail accounts have no Outline token. */
async function createSession(
  reply: FastifyReply,
  userId: string,
  tokens: { accessToken: string; refreshToken?: string | null; expiresIn?: number | null } | null,
  instance: string | null = null
) {
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const maxAge = config.sessionDays * 24 * 3600;
  await query(
    `INSERT INTO sessions (id, user_id, access_token, refresh_token, token_expires_at, expires_at, outline_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      hash(sessionToken),
      userId,
      encrypt(tokens?.accessToken),
      encrypt(tokens?.refreshToken),
      tokens?.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
      new Date(Date.now() + maxAge * 1000),
      instance,
    ]
  );
  reply.setCookie(SESSION_COOKIE, sessionToken, cookieOptions(maxAge));
}

/** Creates a one-time sign-in link for an e-mail account. */
export async function createLoginLink(userId: string, minutes: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await query(`INSERT INTO login_tokens (id, user_id, purpose, expires_at) VALUES ($1, $2, 'magic', $3)`, [
    hash(token),
    userId,
    new Date(Date.now() + minutes * 60_000),
  ]);
  return `${config.appUrl}/login/magic?token=${token}`;
}

/** Imports every user of the Outline workspace so they can receive tasks before their first login. */
async function syncWorkspaceUsers(token: string, instance: string) {
  const limit = 100;
  for (let offset = 0; offset < 10000; offset += limit) {
    const { data } = await outlineApi<OutlineUser[]>(token, "users.list", { limit, offset }, instance);
    if (!data?.length) break;
    await tx(async (client) => {
      for (const u of data) {
        if (!u.isSuspended) await upsertOutlineUser(client, u, { instance });
      }
    });
    if (data.length < limit) break;
  }
}

async function establishSession(
  req: FastifyRequest,
  reply: FastifyReply,
  tokens: { accessToken: string; refreshToken?: string | null; expiresIn?: number | null },
  instance = config.outlineUrl
) {
  const { data } = await outlineApi<{ user: OutlineUser; team: { id: string } }>(tokens.accessToken, "auth.info", {}, instance);
  if (!data?.user?.id) throw new OutlineError(502, "Réponse inattendue : est-ce bien un serveur Outline ?");
  if (instance === config.outlineUrl && config.outlineTeamId && data.team?.id !== config.outlineTeamId) {
    throw new OutlineError(403, "Ce compte n'appartient pas à l'espace de travail Outline autorisé.");
  }
  const userId = await tx((client) => upsertOutlineUser(client, data.user, { login: true, instance }));
  await createSession(reply, userId, tokens, instance);
  req.log.info({ userId, instance }, "User logged in");

  syncWorkspaceUsers(tokens.accessToken, instance).catch((err) => req.log.warn({ err }, "Outline user sync failed"));
  return data.user;
}

async function refreshSessionToken(session: Row): Promise<string | null> {
  const refreshToken = decrypt(session.refresh_token);
  // OAuth (hence refresh tokens) only exists with the configured server.
  if (!refreshToken || !config.oauthEnabled || (session.outline_url && session.outline_url !== config.outlineUrl)) return null;
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

const NO_OUTLINE = "Outline n'est pas accessible aux comptes invités par e-mail.";

function outlineCallerFor(session: Row): OutlineCaller {
  return async (method, body) => {
    if (!session.access_token) throw new OutlineError(403, NO_OUTLINE);
    const instance = session.outline_url ?? config.outlineUrl;
    let token = decrypt(session.access_token)!;
    const expiresSoon = session.token_expires_at && new Date(session.token_expires_at).getTime() < Date.now() + 60_000;
    if (expiresSoon) token = (await refreshSessionToken(session)) || token;
    try {
      return await outlineApi(token, method, body, instance);
    } catch (err) {
      if (err instanceof OutlineError && err.status === 401) {
        const fresh = await refreshSessionToken(session).catch(() => null);
        if (fresh) return outlineApi(fresh, method, body, instance);
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
  app.decorateRequest("outlineUrl", "");
  app.addHook("onRequest", async (req) => {
    req.outlineUrl = config.outlineUrl;
  });

  // Loads the session (if any) on every request.
  app.addHook("onRequest", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await one(
      `SELECT s.*, u.name, u.email, u.avatar_url, u.auth_kind, u.totp_secret IS NOT NULL AS totp
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > now()`,
      [hash(token)]
    );
    if (!session) return;
    req.user = {
      id: session.user_id, name: session.name, email: session.email, avatarUrl: session.avatar_url,
      kind: session.auth_kind, totp: session.totp,
    };
    req.outline = outlineCallerFor(session);
    req.outlineUrl = session.outline_url ?? config.outlineUrl;
  });

  app.get("/api/auth/config", async () => ({
    oauth: config.oauthEnabled,
    apiKey: config.allowApiKeyLogin,
    outlineUrl: config.outlineUrl,
    mail: mailEnabled,
  }));

  // ----- Accounts invited by e-mail: sign-in link, then TOTP if enabled -----

  app.post<{ Body: { email?: string } }>("/api/auth/email", async (req, reply) => {
    if (!mailEnabled) {
      return reply.code(503).send({ error: "L'envoi d'e-mails n'est pas configuré : demandez un lien à la personne qui vous a invité·e." });
    }
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ error: "Adresse e-mail invalide" });
    const user = await one(`SELECT id, name FROM users WHERE auth_kind = 'email' AND lower(email) = $1`, [email]);
    // Same answer whether the address is known or not; at most 5 links per hour.
    if (user) {
      const recent = await one(
        `SELECT count(*)::int AS n FROM login_tokens WHERE user_id = $1 AND purpose = 'magic' AND created_at > now() - interval '1 hour'`,
        [user.id]
      );
      if (recent!.n < 5) {
        const link = await createLoginLink(user.id, LOGIN_LINK_MINUTES);
        await sendLinkMail(email, "Votre lien de connexion à TasksPipes", [
          `Bonjour ${user.name},`,
          `Voici votre lien pour vous connecter à TasksPipes. Il est valable ${LOGIN_LINK_MINUTES} minutes et ne sert qu'une fois.`,
          "Si vous n'avez pas demandé ce lien, ignorez simplement cet e-mail.",
        ], { label: "Se connecter", url: link }).catch((err) => req.log.error({ err }, "Sign-in e-mail failed"));
      } else {
        req.log.warn({ userId: user.id }, "Too many sign-in links requested");
      }
    }
    return { ok: true };
  });

  // The link opens a page that posts the token: e-mail scanners that follow links do not consume it.
  app.post<{ Body: { token?: string } }>("/api/auth/magic", async (req, reply) => {
    const token = String(req.body?.token || "");
    const row = await one(
      `UPDATE login_tokens SET used_at = now()
       WHERE id = $1 AND purpose = 'magic' AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [hash(token)]
    );
    if (!row) return reply.code(400).send({ error: "Ce lien n'est plus valable (déjà utilisé ou expiré). Demandez-en un nouveau." });
    const user = await one(`SELECT id, totp_secret FROM users WHERE id = $1 AND auth_kind = 'email'`, [row.user_id]);
    if (!user) return reply.code(400).send({ error: "Compte introuvable" });
    if (user.totp_secret) {
      const pending = crypto.randomBytes(32).toString("base64url");
      await query(`INSERT INTO login_tokens (id, user_id, purpose, expires_at) VALUES ($1, $2, 'totp', now() + interval '10 minutes')`, [
        hash(pending),
        user.id,
      ]);
      reply.setCookie(TOTP_COOKIE, pending, cookieOptions(600));
      return { totp: true };
    }
    await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    await createSession(reply, user.id, null);
    req.log.info({ userId: user.id }, "User logged in by e-mail link");
    return { ok: true };
  });

  app.post<{ Body: { code?: string } }>("/api/auth/totp", async (req, reply) => {
    const pending = req.cookies[TOTP_COOKIE];
    const row = pending
      ? await one(
          `UPDATE login_tokens SET attempts = attempts + 1
           WHERE id = $1 AND purpose = 'totp' AND used_at IS NULL AND expires_at > now() AND attempts < 5
           RETURNING user_id`,
          [hash(pending)]
        )
      : null;
    if (!row) {
      reply.clearCookie(TOTP_COOKIE, { path: "/" });
      return reply.code(400).send({ error: "Vérification expirée ou trop de tentatives : reconnectez-vous avec un nouveau lien." });
    }
    const user = await one(`SELECT id, totp_secret, totp_last_step FROM users WHERE id = $1`, [row.user_id]);
    const step = user?.totp_secret
      ? verifyTotp(decrypt(user.totp_secret)!, String(req.body?.code || ""), user.totp_last_step === null ? null : Number(user.totp_last_step))
      : null;
    if (step === null) return reply.code(400).send({ error: "Code incorrect" });
    await query(`UPDATE login_tokens SET used_at = now() WHERE id = $1`, [hash(pending!)]);
    await query(`UPDATE users SET totp_last_step = $2, last_login_at = now() WHERE id = $1`, [user!.id, step]);
    reply.clearCookie(TOTP_COOKIE, { path: "/" });
    await createSession(reply, user!.id, null);
    req.log.info({ userId: user!.id }, "User logged in by e-mail link and TOTP");
    return { ok: true };
  });

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

  app.post<{ Body: { token?: string; outlineUrl?: string } }>("/api/auth/apikey", async (req, reply) => {
    if (!config.allowApiKeyLogin) return reply.code(404).send({ error: "Connexion par clé API désactivée" });
    const token = String(req.body?.token || "").trim();
    if (!token) return reply.code(400).send({ error: "Clé API requise" });
    try {
      // The Outline server chosen on the login page (the configured one by default).
      const instance = await normalizeOutlineUrl(req.body?.outlineUrl);
      const user = await establishSession(req, reply, { accessToken: token }, instance);
      return { user };
    } catch (err) {
      const status = err instanceof OutlineError && err.status < 500 ? (err.status === 400 ? 400 : 401) : 502;
      req.log.warn({ err }, "API key login failed");
      const message = status === 401 && (err as OutlineError).status === 401 ? "Clé API Outline invalide" : (err as Error).message;
      return reply.code(status).send({ error: message });
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
  await query(`DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day'`);
}
