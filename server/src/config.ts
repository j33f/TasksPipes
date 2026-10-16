import { readFileSync } from "node:fs";

const trimSlash = (s?: string) => (s || "").replace(/\/+$/, "");

const outlineUrl = trimSlash(process.env.OUTLINE_URL);
const appUrl = trimSlash(process.env.APP_URL || "http://localhost:3000");
const oauthClientId = process.env.OUTLINE_OAUTH_CLIENT_ID || "";
const oauthClientSecret = process.env.OUTLINE_OAUTH_CLIENT_SECRET || "";

/** Version of the server, from its package.json (dist/ in production, src/ in development: both one level down). */
const version: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export const config = {
  version,
  port: Number(process.env.PORT || 3000),
  logLevel: process.env.LOG_LEVEL || "info",
  prettyLogs: process.env.NODE_ENV !== "production",
  appUrl,
  appSecret: process.env.APP_SECRET || "",
  databaseUrl: process.env.DATABASE_URL || "",
  /**
   * Optional Outline server known to the instance: OAuth sign-in works with it, and accounts made before
   * people typed their server belong to it. The login page never suggests it: people type their server.
   */
  outlineUrl,
  /** URL the server uses to reach the Outline API (may be an internal docker URL). */
  outlineApiUrl: trimSlash(process.env.OUTLINE_API_URL) || outlineUrl,
  oauthClientId,
  oauthClientSecret,
  // OAuth works with the configured Outline server only.
  oauthEnabled: Boolean(oauthClientId && oauthClientSecret && outlineUrl),
  allowApiKeyLogin: (process.env.ALLOW_API_KEY_LOGIN ?? "true") !== "false",
  /**
   * Other Outline servers people may sign in with (host names, "*.example.com" allowed).
   * Empty: any public https server.
   */
  outlineAllowedHosts: (process.env.OUTLINE_ALLOWED_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
  /** Lets other Outline servers be on an internal address or in plain http (self-hosting, tests). */
  outlineAllowPrivate: process.env.OUTLINE_ALLOW_PRIVATE === "true",
  /** Optional: restrict login to a single Outline workspace (team id) of the configured server. */
  outlineTeamId: process.env.OUTLINE_TEAM_ID || "",
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  secureCookies: appUrl.startsWith("https://"),
  webDir: process.env.WEB_DIR || "",
  /** Language when neither the page nor the browser gives one ("en" or "fr"). */
  defaultLocale: (process.env.DEFAULT_LOCALE === "fr" ? "fr" : "en") as "en" | "fr",
  /** People can create an account with just their e-mail address and a name (needs SMTP). */
  allowEmailSignup: (process.env.ALLOW_EMAIL_SIGNUP ?? "true") !== "false",
  /** People can invite others by e-mail, or ask people already on the platform to connect. */
  allowEmailInvitations: (process.env.ALLOW_EMAIL_INVITATIONS ?? "true") !== "false",
  /** Sending e-mails (invitations, sign-in links). Without SMTP_HOST, nothing is sent. */
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true" || process.env.SMTP_PORT === "465",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM || process.env.SMTP_USER || "",
  },
};

if (!config.databaseUrl) throw new Error("DATABASE_URL is required");
if (config.appSecret.length < 32) {
  throw new Error("APP_SECRET is required and must be at least 32 characters");
}
