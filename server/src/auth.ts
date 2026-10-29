import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CookieSerializeOptions } from "@fastify/cookie";
import fp from "fastify-plugin";
import { config } from "./config.js";
import { ensureDefaultPipes, one, pool, query, tx, type Queryable, type Row } from "./db.js";
import { absoluteOutlineUrl, normalizeOutlineUrl, outlineApi, outlineToken, OutlineError, type OutlineUser } from "./outline.js";
import { isEmail, mailEnabled, sendLinkMail } from "./mail.js";
import { LIMITS, rateLimited } from "./rate-limit.js";
import { closeUserConnections } from "./realtime.js";
import { V1, tokenUser } from "./api.js";
import { verifyTotp } from "./totp.js";
import { decrypt, encrypt } from "./crypto-box.js";
import { emailDomainAllowed } from "./settings.js";

export { decrypt, encrypt };
import { localeOf, tr, type Locale } from "./i18n.js";

const SESSION_COOKIE = "tp_session";
const STATE_COOKIE = "tp_oauth_state";
const TOTP_COOKIE = "tp_2fa";
/** Validity of a sign-in link: an invitation, or a link asked from the login page. */
/** Sign-in link of an invitation; an account that never used it is then disabled (disableUnusedInvitations). */
export const INVITE_LINK_HOURS = 48;
const LOGIN_LINK_MINUTES = 20;
const SIGNUP_LINK_HOURS = 24;

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  /** "outline": signs in with Outline; "email": invited by e-mail, signs in with e-mailed links; "oidc": company sign-in. */
  kind: "outline" | "email" | "oidc";
  /** Second factor enabled (e-mail accounts). */
  totp: boolean;
  /** Chosen language and theme; null follows the browser / the system. */
  locale: string | null;
  theme: "light" | "dark" | null;
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

export const cookieOptions = (maxAgeSeconds: number): CookieSerializeOptions => ({
  httpOnly: true,
  sameSite: "lax",
  secure: config.secureCookies,
  path: "/",
  maxAge: maxAgeSeconds,
});

/**
 * Sign-in flows under way in this browser (Outline OAuth, OpenID Connect), each found again by its `state` when the
 * provider sends the person back. They are kept together in one encrypted cookie for ten minutes, so that a second
 * flow (another tab, a double click, a sign-in started over) does not wipe out the first one.
 */
const FLOW_SECONDS = 600;
const MAX_FLOWS = 5;
type Flow<T> = T & { state: string; at: number };

function readFlows<T>(req: FastifyRequest, cookie: string): Flow<T>[] {
  try {
    const list = JSON.parse(decrypt(req.cookies[cookie] ?? "") ?? "[]");
    return Array.isArray(list) ? list.filter((f) => typeof f?.state === "string" && Date.now() - f.at < FLOW_SECONDS * 1000) : [];
  } catch {
    return [];
  }
}

function writeFlows(reply: FastifyReply, cookie: string, flows: Flow<unknown>[]) {
  if (flows.length) reply.setCookie(cookie, encrypt(JSON.stringify(flows))!, cookieOptions(FLOW_SECONDS));
  else reply.clearCookie(cookie, { path: "/" });
}

/** Starts a flow carrying `data`; returns its state, to send to the provider. */
export function startFlow(req: FastifyRequest, reply: FastifyReply, cookie: string, data: object = {}): string {
  const state = crypto.randomBytes(16).toString("base64url");
  writeFlows(reply, cookie, [...readFlows(req, cookie), { ...data, state, at: Date.now() }].slice(-MAX_FLOWS));
  return state;
}

/** The flow of `state`, removed from the cookie (a flow is used once); null when unknown or expired. */
export function takeFlow<T>(req: FastifyRequest, reply: FastifyReply, cookie: string, state: string | undefined): Flow<T> | null {
  const flows = readFlows<T>(req, cookie);
  const flow = state ? flows.find((f) => f.state === state) ?? null : null;
  if (flow) writeFlows(reply, cookie, flows.filter((f) => f !== flow));
  return flow;
}

/** Back on the sign-in page with a message (a provider's sign-in that went wrong). */
export const loginError = (reply: FastifyReply, message: string) => reply.redirect(`/login?error=${encodeURIComponent(message)}`);

/** Inserts or updates a user coming from Outline and makes sure they have a personal space. */
/**
 * Inserts or updates a user coming from an Outline server and makes sure they have a personal space.
 * Returns their internal id: the Outline id on the configured server, a new id on another one.
 */
export async function upsertOutlineUser(
  db: Queryable,
  u: OutlineUser,
  { login = false, instance = config.outlineUrl, lang = config.defaultLocale as Locale } = {}
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
  if (!rows[0]) throw new OutlineError(403, "Incompatible account");
  await ensurePersonalSpace(db, rows[0].id, lang);
  return rows[0].id;
}

/** Gives a user their personal space (with its default pipe) if they have none yet. */
export async function ensurePersonalSpace(db: Queryable, userId: string, lang: Locale = config.defaultLocale) {
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
    await ensureDefaultPipes(db, rows[0].id, lang);
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

/** Creates a one-time sign-in link for an e-mail account (`reactivates`: using it turns the account back on). */
export async function createLoginLink(userId: string, minutes: number, { reactivates = false } = {}): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await query(`INSERT INTO login_tokens (id, user_id, purpose, expires_at, reactivates) VALUES ($1, $2, 'magic', $3, $4)`, [
    hash(token),
    userId,
    new Date(Date.now() + minutes * 60_000),
    reactivates,
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

/**
 * Signs in an account proven otherwise (OpenID Connect): with a second factor, its step comes first (the TOTP
 * cookie, then the code page); otherwise a session at once.
 */
export async function signInAccount(reply: FastifyReply, userId: string): Promise<"totp" | "session"> {
  const user = await one(`SELECT totp_secret FROM users WHERE id = $1`, [userId]);
  if (user?.totp_secret) {
    const pending = crypto.randomBytes(32).toString("base64url");
    await query(`INSERT INTO login_tokens (id, user_id, purpose, expires_at) VALUES ($1, $2, 'totp', now() + interval '10 minutes')`, [
      hash(pending),
      userId,
    ]);
    reply.setCookie(TOTP_COOKIE, pending, cookieOptions(600));
    return "totp";
  }
  await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);
  await createSession(reply, userId, null);
  return "session";
}

async function establishSession(
  req: FastifyRequest,
  reply: FastifyReply,
  tokens: { accessToken: string; refreshToken?: string | null; expiresIn?: number | null },
  instance = config.outlineUrl
) {
  if (!config.outlineEnabled) throw new OutlineError(403, "Sign-in with Outline is turned off on this instance.");
  const { data } = await outlineApi<{ user: OutlineUser; team: { id: string } }>(tokens.accessToken, "auth.info", {}, instance);
  if (!data?.user?.id) throw new OutlineError(502, "Unexpected answer: is this really an Outline server?");
  if (instance === config.outlineUrl && config.outlineTeamId && data.team?.id !== config.outlineTeamId) {
    throw new OutlineError(403, "This account does not belong to the allowed Outline workspace.");
  }
  const userId = await tx((client) => upsertOutlineUser(client, data.user, { login: true, instance, lang: localeOf(req) }));
  // An account disabled by an administrator of the instance stays out, even with a valid Outline account.
  if ((await one(`SELECT disabled_reason FROM users WHERE id = $1`, [userId]))?.disabled_reason === "admin") {
    throw new OutlineError(403, "This account is disabled on this instance.");
  }
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

const NO_OUTLINE = "Outline is not available to accounts invited by e-mail.";

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
  throw new OutlineError(401, "Not signed in");
};

async function auth(app: FastifyInstance) {
  app.decorateRequest("user", null);
  app.decorateRequest("outline", noOutline);
  app.decorateRequest("outlineUrl", "");
  app.addHook("onRequest", async (req) => {
    req.outlineUrl = config.outlineUrl;
  });

  // Loads the session (if any) on every request; on the public API, an access token instead.
  app.decorateRequest("apiToken", null);
  app.decorateRequest("apiTokenRefused", false);
  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith(`${V1}/`) && req.headers.authorization) {
      const t = await tokenUser(req.headers.authorization);
      if (t === null) req.apiTokenRefused = true;
      if (t) {
        req.user = {
          id: t.user_id, name: t.name, email: t.email, avatarUrl: t.avatar_url,
          kind: t.auth_kind, totp: t.totp, locale: t.locale, theme: t.theme,
        };
        req.apiToken = { id: t.id, scope: t.scope };
      }
      if (t !== undefined) return;
    }
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await one(
      `SELECT s.*, u.name, u.email, u.avatar_url, u.auth_kind, u.totp_secret IS NOT NULL AS totp, u.locale, u.theme
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > now() AND u.disabled_at IS NULL`,
      [hash(token)]
    );
    if (!session) return;
    req.user = {
      id: session.user_id, name: session.name, email: session.email, avatarUrl: session.avatar_url,
      kind: session.auth_kind, totp: session.totp, locale: session.locale, theme: session.theme,
    };
    req.outline = outlineCallerFor(session);
    req.outlineUrl = session.outline_url ?? config.outlineUrl;
  });

  app.get("/api/auth/config", async () => ({
    oauth: config.oauthEnabled,
    apiKey: config.allowApiKeyLogin,
    // With OAuth set up, the login page signs in with this server without asking for one.
    outlineUrl: config.oauthEnabled ? config.outlineUrl : null,
    mail: mailEnabled(),
    signup: config.allowEmailSignup && mailEnabled(),
    // Company sign-in (OpenID Connect): the button's label.
    oidc: config.oidc.enabled ? { name: config.oidc.name } : null,
  }));

  // ----- Sign-up with an e-mail address and a name -----------------------------

  // A few sign-ups per address per hour, so the form cannot be used to flood mailboxes.
  app.post<{ Body: { email?: string; name?: string } }>("/api/auth/signup", rateLimited(LIMITS.signup), async (req, reply) => {
    const lang = localeOf(req);
    if (!config.allowEmailSignup || !mailEnabled()) return reply.code(403).send({ error: tr(lang, "Sign-up is turned off on this instance") });
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = String(req.body?.name || "").trim().slice(0, 120);
    if (!isEmail(email)) return reply.code(400).send({ error: tr(lang, "Invalid e-mail address") });
    if (!name) return reply.code(400).send({ error: tr(lang, "{label} is required", { label: "Name" }) });
    if (!emailDomainAllowed(email)) return reply.code(403).send({ error: tr(lang, "Addresses of this domain cannot sign up here") });

    // The answer is the same whatever happens, so the form does not tell who has an account.
    const existing = await one(
      `SELECT id, name, auth_kind, locale, disabled_at, disabled_reason FROM users WHERE lower(email) = $1 ORDER BY auth_kind = 'email' DESC LIMIT 1`,
      [email]
    );
    const send = (l: Locale, subject: string, lines: string[], link: string, label: string) =>
      sendLinkMail(l, email, subject, lines, { label, url: link }).catch((err) => req.log.error({ err }, "Sign-up e-mail failed"));
    if (existing?.auth_kind === "oidc") {
      const l: Locale = existing.locale ?? lang;
      await send(l, tr(l, "Welcome to TasksPipes"), [
        tr(l, "Hello {name},", { name: existing.name }),
        tr(l, "You already have an account on TasksPipes: sign in with {provider}.", { provider: config.oidc.name }),
      ], `${config.appUrl}/login`, tr(l, "Sign in"));
    } else if (existing?.auth_kind === "outline") {
      const l: Locale = existing.locale ?? lang;
      await send(l, tr(l, "Welcome to TasksPipes"), [
        tr(l, "Hello {name},", { name: existing.name }),
        tr(l, "You already have an account on TasksPipes with your Outline account: sign in with Outline."),
      ], `${config.appUrl}/login`, tr(l, "Sign in"));
    } else if (existing?.disabled_reason === "unused_invitation") {
      // An invitation never used: signing up gets the account back, once the link proves the address.
      const l: Locale = existing.locale ?? lang;
      const link = await createLoginLink(existing.id, SIGNUP_LINK_HOURS * 60, { reactivates: true });
      await send(l, tr(l, "Welcome to TasksPipes"), [
        tr(l, "Hello {name},", { name: existing.name }),
        tr(l, "Your account is ready. This link confirms your address and signs you in; it is valid for {hours} hours and works only once.", { hours: SIGNUP_LINK_HOURS }),
        tr(l, "If you did not ask for this link, just ignore this e-mail."),
      ], link, tr(l, "Sign in"));
    } else if (existing?.disabled_at) {
      // Any other disabled account gets nothing.
    } else if (existing) {
      const l: Locale = existing.locale ?? lang;
      const link = await createLoginLink(existing.id, LOGIN_LINK_MINUTES);
      await send(l, tr(l, "Your TasksPipes sign-in link"), [
        tr(l, "Hello {name},", { name: existing.name }),
        tr(l, "Here is your link to sign in to TasksPipes. It is valid for {minutes} minutes and works only once.", { minutes: LOGIN_LINK_MINUTES }),
        tr(l, "If you did not ask for this link, just ignore this e-mail."),
      ], link, tr(l, "Sign in"));
    } else {
      const user = await tx(async (client) => {
        const u = await one(
          `INSERT INTO users (id, name, email, auth_kind, locale) VALUES (gen_uuidv7(), $1, $2, 'email', NULL) RETURNING id`,
          [name, email],
          client
        );
        await ensurePersonalSpace(client, u!.id, lang);
        return u!;
      });
      const link = await createLoginLink(user.id, SIGNUP_LINK_HOURS * 60);
      await send(lang, tr(lang, "Welcome to TasksPipes"), [
        tr(lang, "Hello {name},", { name }),
        tr(lang, "Your account is ready. This link confirms your address and signs you in; it is valid for {hours} hours and works only once.", { hours: SIGNUP_LINK_HOURS }),
        tr(lang, "If you did not ask for this link, just ignore this e-mail."),
      ], link, tr(lang, "Sign in"));
    }
    return { ok: true };
  });

  // ----- Accounts invited by e-mail: sign-in link, then TOTP if enabled -----

  app.post<{ Body: { email?: string } }>("/api/auth/email", rateLimited(LIMITS.signInLink), async (req, reply) => {
    const lang = localeOf(req);
    if (!mailEnabled()) {
      return reply.code(503).send({ error: tr(lang, "E-mail sending is not set up: ask the person who invited you for a link.") });
    }
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!isEmail(email)) return reply.code(400).send({ error: tr(lang, "Invalid e-mail address") });
    const user = await one(`SELECT id, name, locale FROM users WHERE auth_kind = 'email' AND lower(email) = $1 AND disabled_at IS NULL`, [email]);
    // Same answer whether the address is known or not; at most 5 links per hour.
    if (user) {
      const recent = await one(
        `SELECT count(*)::int AS n FROM login_tokens WHERE user_id = $1 AND purpose = 'magic' AND created_at > now() - interval '1 hour'`,
        [user.id]
      );
      if (recent!.n < 5) {
        const link = await createLoginLink(user.id, LOGIN_LINK_MINUTES);
        // In the language the person chose, else the one of the page asking for the link.
        const l: Locale = user.locale ?? lang;
        await sendLinkMail(l, email, tr(l, "Your TasksPipes sign-in link"), [
          tr(l, "Hello {name},", { name: user.name }),
          tr(l, "Here is your link to sign in to TasksPipes. It is valid for {minutes} minutes and works only once.", { minutes: LOGIN_LINK_MINUTES }),
          tr(l, "If you did not ask for this link, just ignore this e-mail."),
        ], { label: tr(l, "Sign in"), url: link }).catch((err) => req.log.error({ err }, "Sign-in e-mail failed"));
      } else {
        req.log.warn({ userId: user.id }, "Too many sign-in links requested");
      }
    }
    return { ok: true };
  });

  // The link opens a page that posts the token: e-mail scanners that follow links do not consume it.
  app.post<{ Body: { token?: string } }>("/api/auth/magic", rateLimited(LIMITS.magic), async (req, reply) => {
    const token = String(req.body?.token || "");
    const row = await one(
      `UPDATE login_tokens SET used_at = now()
       WHERE id = $1 AND purpose = 'magic' AND used_at IS NULL AND expires_at > now() RETURNING user_id, reactivates`,
      [hash(token)]
    );
    if (!row) return reply.code(400).send({ error: tr(localeOf(req), "This link is no longer valid (already used or expired). Ask for a new one.") });
    const user = await one(`SELECT id, totp_secret, disabled_at, disabled_reason FROM users WHERE id = $1 AND auth_kind = 'email'`, [row.user_id]);
    if (!user) return reply.code(400).send({ error: tr(localeOf(req), "Account not found") });
    if (user.disabled_at) {
      // A link sent by signing up again gets back an account whose invitation was never used; other links of a
      // disabled account no longer work (same answer as an expired link).
      if (!row.reactivates || user.disabled_reason !== "unused_invitation") {
        return reply.code(400).send({ error: tr(localeOf(req), "This link is no longer valid (already used or expired). Ask for a new one.") });
      }
      await reenableInvited(user.id);
    }
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

  app.post<{ Body: { code?: string } }>("/api/auth/totp", rateLimited(LIMITS.totp), async (req, reply) => {
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
      return reply.code(400).send({ error: tr(localeOf(req), "Verification expired or too many attempts: sign in again with a new link.") });
    }
    const user = await one(`SELECT id, totp_secret, totp_last_step FROM users WHERE id = $1 AND disabled_at IS NULL`, [row.user_id]);
    const step = user?.totp_secret
      ? verifyTotp(decrypt(user.totp_secret)!, String(req.body?.code || ""), user.totp_last_step === null ? null : Number(user.totp_last_step))
      : null;
    if (step === null) return reply.code(400).send({ error: tr(localeOf(req), "Wrong code") });
    await query(`UPDATE login_tokens SET used_at = now() WHERE id = $1`, [hash(pending!)]);
    await query(`UPDATE users SET totp_last_step = $2, last_login_at = now() WHERE id = $1`, [user!.id, step]);
    reply.clearCookie(TOTP_COOKIE, { path: "/" });
    await createSession(reply, user!.id, null);
    req.log.info({ userId: user!.id }, "User logged in by e-mail link and TOTP");
    return { ok: true };
  });

  app.get("/auth/outline", rateLimited(LIMITS.oauth), async (req, reply) => {
    if (!config.oauthEnabled) return loginError(reply, tr(localeOf(req), "OAuth is not set up"));
    const state = startFlow(req, reply, STATE_COOKIE);
    const url = new URL(`${config.outlineUrl}/oauth/authorize`);
    url.searchParams.set("client_id", config.oauthClientId);
    url.searchParams.set("redirect_uri", `${config.appUrl}/auth/outline/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "read write");
    url.searchParams.set("state", state);
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: Record<string, string | undefined> }>("/auth/outline/callback", rateLimited(LIMITS.oauth), async (req, reply) => {
    const fail = (msg: string) => loginError(reply, msg);
    try {
      const flow = takeFlow(req, reply, STATE_COOKIE, req.query.state);
      if (req.query.error) return fail(req.query.error_description || req.query.error);
      if (!flow || !req.query.code) {
        // Already signed in: this return was played again (back button, a second tab); nothing to do.
        if (req.user) return reply.redirect("/");
        req.log.warn({ cookie: Boolean(req.cookies[STATE_COOKIE]), state: Boolean(req.query.state) }, "OAuth sign-in with an unknown state");
        return fail(tr(localeOf(req), "Sign-in expired or interrupted, please try again."));
      }
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
      return fail(err instanceof OutlineError ? tr(localeOf(req), err.message, err.params) : tr(localeOf(req), "Sign-in failed"));
    }
  });

  app.post<{ Body: { token?: string; outlineUrl?: string } }>("/api/auth/apikey", rateLimited(LIMITS.apiKey), async (req, reply) => {
    if (!config.allowApiKeyLogin) return reply.code(404).send({ error: tr(localeOf(req), "API key sign-in is disabled") });
    const token = String(req.body?.token || "").trim();
    if (!token) return reply.code(400).send({ error: tr(localeOf(req), "API key required") });
    try {
      // The Outline server chosen on the login page (the configured one by default).
      const instance = await normalizeOutlineUrl(req.body?.outlineUrl);
      const user = await establishSession(req, reply, { accessToken: token }, instance);
      return { user };
    } catch (err) {
      const status = err instanceof OutlineError && err.status < 500 ? (err.status === 400 ? 400 : 401) : 502;
      req.log.warn({ err }, "API key login failed");
      const lang = localeOf(req);
      const message =
        status === 401 && (err as OutlineError).status === 401
          ? tr(lang, "Invalid Outline API key")
          : err instanceof OutlineError ? tr(lang, err.message, err.params) : (err as Error).message;
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

/**
 * Disables the accounts created by an invitation that were never used: no sign-in, no valid link left, and made
 * more than INVITE_LINK_HOURS ago. Accounts made by signing up are left alone (nobody sees them). Returns how many.
 */
export async function disableUnusedInvitations(): Promise<number> {
  const { rowCount } = await query(
    `UPDATE users u SET disabled_at = now(), disabled_reason = 'unused_invitation'
     WHERE u.auth_kind = 'email' AND u.last_login_at IS NULL AND u.disabled_at IS NULL
       AND u.created_at < now() - make_interval(hours => $1)
       AND EXISTS (SELECT 1 FROM invitations i WHERE i.invitee_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM login_tokens l WHERE l.user_id = u.id AND l.purpose = 'magic' AND l.used_at IS NULL AND l.expires_at > now())`,
    [INVITE_LINK_HOURS]
  );
  return rowCount ?? 0;
}

/** Turns an account disabled for an unused invitation back on (it is being invited again). */
export async function reenableInvited(userId: string, db: Queryable = pool) {
  await db.query(`UPDATE users SET disabled_at = NULL, disabled_reason = NULL WHERE id = $1 AND disabled_reason = 'unused_invitation'`, [userId]);
}

/**
 * Closes the sessions of Outline accounts whose Outline access ended (token revoked, account suspended or deleted in
 * Outline): each session's token is checked with auth.info, refreshed first when it can be. Returns how many closed.
 * Outline being unreachable closes nothing.
 */
export async function checkOutlineSessions(): Promise<number> {
  const { rows } = await query(
    `SELECT s.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE u.auth_kind = 'outline' AND s.access_token IS NOT NULL AND s.expires_at > now()`
  );
  let closed = 0;
  for (const session of rows) {
    try {
      await outlineCallerFor(session)("auth.info", {});
    } catch (err) {
      if (!(err instanceof OutlineError) || (err.status !== 401 && err.status !== 403)) continue;
      await query(`DELETE FROM sessions WHERE id = $1`, [session.id]);
      if (!(await one(`SELECT 1 FROM sessions WHERE user_id = $1`, [session.user_id]))) closeUserConnections(session.user_id);
      closed++;
    }
  }
  return closed;
}

export async function cleanupSessions() {
  await query(`DELETE FROM sessions WHERE expires_at < now()`);
  await query(`DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day'`);
}
