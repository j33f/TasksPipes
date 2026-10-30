/**
 * Settings of the instance that administrators can change in the app (settings.ts): e-mail, Outline, sign-in. Each
 * one is read, in order, from its environment variable (which then locks it: the host keeps the last word), from the
 * database (instance_settings, kept here in memory), or its default. An empty environment variable counts as unset.
 * This module has no dependency, so that config.ts can read it.
 */

export type SettingKind = "string" | "url" | "bool" | "int" | "list" | "secret";

export interface SettingDef {
  key: string;
  env: string;
  kind: SettingKind;
  section: "smtp" | "outline" | "outlineOauth" | "signin" | "oidc" | "push" | "updates";
  default: string | number | boolean | string[] | null;
}

export const SETTINGS: SettingDef[] = [
  { key: "smtp.host", env: "SMTP_HOST", kind: "string", section: "smtp", default: "" },
  { key: "smtp.port", env: "SMTP_PORT", kind: "int", section: "smtp", default: 587 },
  // null: TLS from the start on port 465 only.
  { key: "smtp.secure", env: "SMTP_SECURE", kind: "bool", section: "smtp", default: null },
  { key: "smtp.user", env: "SMTP_USER", kind: "string", section: "smtp", default: "" },
  { key: "smtp.pass", env: "SMTP_PASS", kind: "secret", section: "smtp", default: "" },
  { key: "smtp.from", env: "MAIL_FROM", kind: "string", section: "smtp", default: "" },

  { key: "outline.enabled", env: "OUTLINE_ENABLED", kind: "bool", section: "outline", default: true },
  { key: "outline.url", env: "OUTLINE_URL", kind: "url", section: "outline", default: "" },
  { key: "outline.apiUrl", env: "OUTLINE_API_URL", kind: "url", section: "outline", default: "" },
  { key: "outline.allowedHosts", env: "OUTLINE_ALLOWED_HOSTS", kind: "list", section: "outline", default: [] },
  { key: "outline.allowPrivate", env: "OUTLINE_ALLOW_PRIVATE", kind: "bool", section: "outline", default: false },
  { key: "outline.teamId", env: "OUTLINE_TEAM_ID", kind: "string", section: "outline", default: "" },
  { key: "outline.apiKeyLogin", env: "ALLOW_API_KEY_LOGIN", kind: "bool", section: "outline", default: true },

  { key: "outline.oauthClientId", env: "OUTLINE_OAUTH_CLIENT_ID", kind: "string", section: "outlineOauth", default: "" },
  { key: "outline.oauthClientSecret", env: "OUTLINE_OAUTH_CLIENT_SECRET", kind: "secret", section: "outlineOauth", default: "" },

  { key: "signin.emailSignup", env: "ALLOW_EMAIL_SIGNUP", kind: "bool", section: "signin", default: true },
  { key: "signin.emailInvitations", env: "ALLOW_EMAIL_INVITATIONS", kind: "bool", section: "signin", default: true },
  { key: "signin.emailDomains", env: "EMAIL_DOMAINS", kind: "list", section: "signin", default: [] },

  { key: "oidc.enabled", env: "OIDC_ENABLED", kind: "bool", section: "oidc", default: true },
  { key: "oidc.issuer", env: "OIDC_ISSUER", kind: "url", section: "oidc", default: "" },
  { key: "oidc.clientId", env: "OIDC_CLIENT_ID", kind: "string", section: "oidc", default: "" },
  { key: "oidc.clientSecret", env: "OIDC_CLIENT_SECRET", kind: "secret", section: "oidc", default: "" },
  { key: "oidc.name", env: "OIDC_NAME", kind: "string", section: "oidc", default: "SSO" },
  { key: "oidc.scopes", env: "OIDC_SCOPES", kind: "string", section: "oidc", default: "openid email profile" },
  { key: "oidc.allowedDomains", env: "OIDC_ALLOWED_DOMAINS", kind: "list", section: "oidc", default: [] },

  // Web Push (push.ts). Empty keys: one is derived from APP_SECRET. The subject is a contact for push services.
  { key: "push.vapidPublicKey", env: "VAPID_PUBLIC_KEY", kind: "string", section: "push", default: "" },
  { key: "push.vapidPrivateKey", env: "VAPID_PRIVATE_KEY", kind: "secret", section: "push", default: "" },
  { key: "push.vapidSubject", env: "VAPID_SUBJECT", kind: "string", section: "push", default: "" },

  { key: "updates.check", env: "UPDATE_CHECK", kind: "bool", section: "updates", default: true },
];

export const settingDef = (key: string) => SETTINGS.find((d) => d.key === key);

/** A value from text (an environment variable). */
export function parseSetting(def: SettingDef, raw: string): unknown {
  switch (def.kind) {
    case "bool":
      return !["false", "0", "no", "off"].includes(raw.trim().toLowerCase());
    case "int":
      return Number.isFinite(Number(raw)) ? Number(raw) : def.default;
    case "list":
      return raw.split(",").map((s) => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
    case "url":
      return raw.trim().replace(/\/+$/, "");
    default:
      return raw;
  }
}

/** The value of the environment variable, or undefined when it is unset or empty. */
export function envSetting(def: SettingDef): unknown {
  const raw = process.env[def.env];
  return raw === undefined || raw === "" ? undefined : parseSetting(def, raw);
}

/** Whether the environment sets (and so locks) a setting. */
export const lockedSetting = (key: string) => envSetting(settingDef(key)!) !== undefined;

const stored = new Map<string, unknown>();
/** Values set by the tests, above everything else. */
const overrides = new Map<string, unknown>();

/** Replaces the values kept from the database (secrets already decrypted). */
export function setStoredSettings(values: Map<string, unknown>) {
  stored.clear();
  for (const [k, v] of values) stored.set(k, v);
}

export const storedSetting = (key: string) => stored.get(key);

/** For the tests: a value above everything else (undefined removes it). */
export function overrideSetting(key: string, value: unknown) {
  if (value === undefined) overrides.delete(key);
  else overrides.set(key, value);
}

/**
 * The value of a setting: the environment's, else the database's, else its default. `proposed` gives values not
 * saved yet (to check a change before making it).
 */
export function setting<T = unknown>(key: string, proposed?: Record<string, unknown>): T {
  const def = settingDef(key);
  if (!def) throw new Error(`Unknown setting ${key}`);
  if (overrides.has(key)) return overrides.get(key) as T;
  const env = envSetting(def);
  if (env !== undefined) return env as T;
  if (proposed && key in proposed) return (proposed[key] ?? def.default) as T;
  return (stored.has(key) ? stored.get(key) : def.default) as T;
}
