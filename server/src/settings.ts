/**
 * Administration › Settings: e-mail, Outline and sign-in, changed while the server runs (settings-store.ts holds
 * them, config.ts reads them). A setting given by an environment variable is shown locked. Secrets are kept
 * encrypted with APP_SECRET and never sent back: they can only be replaced. A change that would leave the
 * administrator making it, or every administrator, unable to sign in is refused. Every change is recorded.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { loadSettings, query, tx, type Row } from "./db.js";
import { bad } from "./errors.js";
import { encrypt } from "./crypto-box.js";
import { isEmail, sendLinkMail, verifyMail } from "./mail.js";
import { closeUserConnections } from "./realtime.js";
import { LIMITS, rateLimited } from "./rate-limit.js";
import { localeOf, tr } from "./i18n.js";
import { SETTINGS, lockedSetting, setting, settingDef, storedSetting, type SettingDef } from "./settings-store.js";

const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** A value sent by the administration page, checked; null puts the default back. */
export function cleanSetting(def: SettingDef, v: unknown): unknown {
  if (v === null) return null;
  const label = { key: def.key };
  switch (def.kind) {
    case "bool":
      if (typeof v !== "boolean") throw bad("Invalid value for {key}", label);
      return v;
    case "int": {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw bad("Invalid value for {key}", label);
      return n;
    }
    case "list": {
      const list = (Array.isArray(v) ? v : String(v).split(/[\s,]+/)).map((x) => String(x).trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
      const pattern = def.key === "outline.allowedHosts" ? HOST : DOMAIN;
      const wrong = list.find((x) => x.length > 253 || !pattern.test(x));
      if (wrong) throw bad("Invalid value for {key}: {value}", { ...label, value: wrong });
      if (list.length > 100) throw bad("Invalid value for {key}", label);
      return [...new Set(list)];
    }
    case "url": {
      const s = String(v).trim().replace(/\/+$/, "");
      if (!s) return "";
      let u: URL;
      try {
        u = new URL(s);
      } catch {
        throw bad("Invalid value for {key}", label);
      }
      if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || s.length > 500) throw bad("Invalid value for {key}", label);
      return s;
    }
    default: {
      if (typeof v !== "string" || v.length > 500) throw bad("Invalid value for {key}", label);
      const s = def.kind === "secret" ? v : v.trim();
      if (def.key === "smtp.from" && s && !isEmail(s.match(/<([^>]+)>\s*$/)?.[1] ?? s)) throw bad("Invalid value for {key}", label);
      return s;
    }
  }
}

// ---------------------------------------------------------------------------
// Who could still sign in

type Get = <T>(key: string) => T;

/** Whether an account could sign in with these settings. */
export function canSignIn(u: Row, get: Get): boolean {
  const outlineUrl = get<string>("outline.url");
  const oidcOn = Boolean(get<boolean>("oidc.enabled") && get<string>("oidc.issuer") && get<string>("oidc.clientId"));
  if (u.oidc_sub && oidcOn && u.oidc_issuer === get<string>("oidc.issuer")) return true;
  if (u.auth_kind === "email") return Boolean(get<string>("smtp.host") && (get<string>("smtp.from") || get<string>("smtp.user")));
  if (u.auth_kind !== "outline" || !get<boolean>("outline.enabled")) return false;
  const apiKey = get<boolean>("outline.apiKeyLogin");
  const server = u.outline_url ?? outlineUrl;
  if (server && server === outlineUrl) {
    return apiKey || Boolean(get<string>("outline.oauthClientId") && get<string>("outline.oauthClientSecret"));
  }
  // Another server: with an API key, if it is still allowed.
  const hosts = get<string[]>("outline.allowedHosts");
  const host = (() => {
    try {
      return new URL(server).hostname;
    } catch {
      return "";
    }
  })();
  return apiKey && (!hosts.length || hosts.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h)));
}

/** Whether an account is an administrator with these settings (see isInstanceAdmin in admin.ts). */
function adminWith(u: Row, get: Get): boolean {
  if (!u.email || !config.adminEmails.includes(String(u.email).toLowerCase())) return false;
  if (u.auth_kind === "email") return true;
  if (u.auth_kind === "oidc") return Boolean(u.oidc_email_verified) && u.oidc_issuer === get<string>("oidc.issuer");
  const url = get<string>("outline.url");
  return u.auth_kind === "outline" && Boolean(url) && (u.outline_url ?? url) === url;
}

/** Refuses a change that would leave the administrator making it, or every administrator, unable to sign in. */
async function assertAdminsKeepAccess(meId: string, proposed: Record<string, unknown>) {
  const get: Get = <T>(key: string) => setting<T>(key, proposed);
  const { rows } = await query(
    `SELECT id, email, auth_kind, outline_url, oidc_issuer, oidc_sub, oidc_email_verified FROM users
     WHERE disabled_at IS NULL AND auth_kind IN ('outline', 'email', 'oidc') AND email IS NOT NULL`
  );
  const me = rows.find((u) => u.id === meId);
  if (me && !canSignIn(me, get)) throw bad("With these settings, you could no longer sign in: change them another way first.");
  if (!rows.some((u) => adminWith(u, get) && canSignIn(u, get))) throw bad("With these settings, no administrator could sign in any more.");
}

// ---------------------------------------------------------------------------
// Reading and saving

/** What the page shows: each setting, its value (never a secret's), whether it is locked by the environment. */
export function presentSettings() {
  return SETTINGS.map((d) => {
    const value = setting(d.key);
    return {
      key: d.key,
      section: d.section,
      kind: d.kind,
      locked: lockedSetting(d.key),
      env: d.env,
      default: d.default,
      // A secret only tells whether it is set.
      value: d.kind === "secret" ? null : value,
      isSet: d.kind === "secret" ? Boolean(value) : undefined,
    };
  });
}

/** History entry of a value: a secret is never written down. */
const logged = (d: SettingDef, v: unknown) => (d.kind === "secret" ? (v ? "(set)" : null) : v ?? null);

/** Saves changes (checked by the caller); returns the keys changed. */
export async function saveSettings(changes: Record<string, unknown>, userId: string): Promise<string[]> {
  const changed: string[] = [];
  await tx(async (db) => {
    for (const [key, value] of Object.entries(changes)) {
      const d = settingDef(key)!;
      const before = storedSetting(key);
      if (JSON.stringify(before ?? null) === JSON.stringify(value ?? null)) continue;
      if (value === null) {
        await db.query(`DELETE FROM instance_settings WHERE key = $1`, [key]);
      } else {
        const stored = d.kind === "secret" ? { enc: encrypt(String(value)) } : value;
        await db.query(
          `INSERT INTO instance_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = now()`,
          [key, JSON.stringify(stored), userId]
        );
      }
      await db.query(`INSERT INTO instance_settings_history (key, old_value, new_value, changed_by) VALUES ($1, $2, $3, $4)`, [
        key, JSON.stringify(logged(d, before)), JSON.stringify(logged(d, value)), userId,
      ]);
      changed.push(key);
    }
  });
  await loadSettings();
  return changed;
}

/** Outline turned off: Outline accounts are signed out at once. */
async function signOutOutlineAccounts() {
  const { rows } = await query(
    `DELETE FROM sessions s USING users u WHERE u.id = s.user_id AND u.auth_kind = 'outline' RETURNING s.user_id`
  );
  for (const id of new Set(rows.map((r) => r.user_id as string))) closeUserConnections(id);
}

/** Settings changed on another instance reach this one within this time. */
export const SETTINGS_REFRESH_MS = 30_000;

type Req = FastifyRequest<{ Body: Record<string, unknown> }>;

/** Routes of the administration (registered behind its check: administrators only). */
export async function settingsRoutes(app: FastifyInstance) {
  app.get("/admin/settings", async () => ({
    settings: presentSettings(),
    oauthRedirect: `${config.appUrl}/auth/outline/callback`,
    oidcRedirect: `${config.appUrl}/auth/oidc/callback`,
  }));

  app.put("/admin/settings", rateLimited(LIMITS.adminSettings), async (req: Req) => {
    const body = req.body?.settings;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("Invalid settings");
    const changes: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(body as Record<string, unknown>)) {
      const d = settingDef(key);
      if (!d) throw bad("Unknown setting: {key}", { key });
      if (lockedSetting(key)) throw bad("{key} is set by the server ({env}): change it there", { key, env: d.env });
      // An empty secret keeps the current one.
      if (d.kind === "secret" && raw === "") continue;
      changes[key] = cleanSetting(d, raw);
    }
    await assertAdminsKeepAccess(req.user!.id, changes);
    const wasOutline = config.outlineEnabled;
    const changed = await saveSettings(changes, req.user!.id);
    if (wasOutline && !config.outlineEnabled) await signOutOutlineAccounts();
    req.log.info({ by: req.user!.id, keys: changed }, "Instance settings changed");
    return { settings: presentSettings(), changed };
  });

  // Checks the SMTP connection, then sends a test e-mail to the administrator.
  app.post("/admin/settings/test-mail", rateLimited(LIMITS.adminTestMail), async (req) => {
    const lang = localeOf(req);
    const to = req.user!.email;
    if (!to) throw bad("Your account has no e-mail address");
    try {
      await verifyMail();
      await sendLinkMail(lang, to, tr(lang, "TasksPipes: test e-mail"), [tr(lang, "E-mail sending works.")], {
        label: tr(lang, "Open TasksPipes"), url: config.appUrl,
      });
    } catch (err) {
      // The server's answer, without the credentials.
      throw bad("Sending failed: {error}", { error: String((err as Error).message ?? err).replace(String(config.smtp.pass || "\u0000"), "***").slice(0, 300) });
    }
    return { ok: true, to };
  });

  app.get("/admin/settings/history", async () => {
    const { rows } = await query(
      `SELECT h.key, h.old_value, h.new_value, h.changed_at, u.name AS by_name FROM instance_settings_history h
       LEFT JOIN users u ON u.id = h.changed_by ORDER BY h.id DESC LIMIT 100`
    );
    return rows.map((r) => ({ key: r.key, from: r.old_value, to: r.new_value, at: r.changed_at, by: r.by_name ?? null }));
  });
}

/** Whether an e-mail address may sign up or be invited (signin.emailDomains, when set). */
export const emailDomainAllowed = (email: string) =>
  !config.emailDomains.length || config.emailDomains.includes(email.toLowerCase().split("@")[1] ?? "");

