const trimSlash = (s?: string) => (s || "").replace(/\/+$/, "");

const outlineUrl = trimSlash(process.env.OUTLINE_URL);
const appUrl = trimSlash(process.env.APP_URL || "http://localhost:3000");
const oauthClientId = process.env.OUTLINE_OAUTH_CLIENT_ID || "";
const oauthClientSecret = process.env.OUTLINE_OAUTH_CLIENT_SECRET || "";

export const config = {
  port: Number(process.env.PORT || 3000),
  logLevel: process.env.LOG_LEVEL || "info",
  prettyLogs: process.env.NODE_ENV !== "production",
  appUrl,
  appSecret: process.env.APP_SECRET || "",
  databaseUrl: process.env.DATABASE_URL || "",
  /** Public Outline URL: used for browser redirects and document links. */
  outlineUrl,
  /** URL the server uses to reach the Outline API (may be an internal docker URL). */
  outlineApiUrl: trimSlash(process.env.OUTLINE_API_URL) || outlineUrl,
  oauthClientId,
  oauthClientSecret,
  oauthEnabled: Boolean(oauthClientId && oauthClientSecret),
  allowApiKeyLogin: (process.env.ALLOW_API_KEY_LOGIN ?? "true") !== "false",
  /** Optional: restrict login to a single Outline workspace (team id). */
  outlineTeamId: process.env.OUTLINE_TEAM_ID || "",
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  secureCookies: appUrl.startsWith("https://"),
  webDir: process.env.WEB_DIR || "",
};

if (!config.outlineUrl) throw new Error("OUTLINE_URL is required");
if (!config.databaseUrl) throw new Error("DATABASE_URL is required");
if (config.appSecret.length < 32) {
  throw new Error("APP_SECRET is required and must be at least 32 characters");
}
