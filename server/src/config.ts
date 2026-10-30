import { readFileSync } from "node:fs";
import { overrideSetting, setting } from "./settings-store.js";

const trimSlash = (s?: string) => (s || "").replace(/\/+$/, "");

const appUrl = trimSlash(process.env.APP_URL || "http://localhost:3000");
/** A setting changed by the administrators (settings-store.ts); its environment variable, when set, locks it. */
const s = <T>(key: string) => setting<T>(key);

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
  /** One-click updates: the updater service and its shared token (docs/HOSTING.md); off without a token. */
  updaterToken: process.env.UPDATER_TOKEN || "",
  updaterUrl: trimSlash(process.env.UPDATER_URL || (process.env.UPDATER_TOKEN ? "http://updater:8080" : "")),
  // The settings below can change while the server runs (Administration › Settings): read them each time.
  /** Outline as a way to sign in and as a source of documents; off, Outline accounts can no longer sign in. */
  get outlineEnabled() {
    return s<boolean>("outline.enabled");
  },
  /**
   * Optional Outline server known to the instance: OAuth sign-in works with it, and accounts made before
   * people typed their server belong to it. The login page never suggests it: people type their server.
   */
  get outlineUrl() {
    return trimSlash(s<string>("outline.url"));
  },
  /** URL the server uses to reach the Outline API (may be an internal docker URL). */
  get outlineApiUrl() {
    return trimSlash(s<string>("outline.apiUrl")) || this.outlineUrl;
  },
  get oauthClientId() {
    return s<string>("outline.oauthClientId");
  },
  get oauthClientSecret() {
    return s<string>("outline.oauthClientSecret");
  },
  // OAuth works with the configured Outline server only.
  get oauthEnabled() {
    return Boolean(this.outlineEnabled && this.oauthClientId && this.oauthClientSecret && this.outlineUrl);
  },
  get allowApiKeyLogin() {
    return this.outlineEnabled && s<boolean>("outline.apiKeyLogin");
  },
  /**
   * Other Outline servers people may sign in with (host names, "*.example.com" allowed).
   * Empty: any public https server.
   */
  get outlineAllowedHosts() {
    return s<string[]>("outline.allowedHosts");
  },
  /** Lets other Outline servers be on an internal address or in plain http (self-hosting, tests). */
  get outlineAllowPrivate() {
    return s<boolean>("outline.allowPrivate");
  },
  /** Optional: restrict login to a single Outline workspace (team id) of the configured server. */
  get outlineTeamId() {
    return s<string>("outline.teamId");
  },
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  secureCookies: appUrl.startsWith("https://"),
  webDir: process.env.WEB_DIR || "",
  /** Time zone of the reports, and the hour (0-23) at which daily and weekly reports are due. */
  timezone: process.env.TIMEZONE || "UTC",
  reportHour: Math.min(23, Math.max(0, Number(process.env.REPORT_HOUR ?? 18) || 0)),
  /** Language when neither the page nor the browser gives one: a file of locales/ ("en", "fr"…; else "en"). */
  defaultLocale: process.env.DEFAULT_LOCALE || "en",
  /** People can create an account with just their e-mail address and a name (needs SMTP). */
  get allowEmailSignup() {
    return s<boolean>("signin.emailSignup");
  },
  /** People can invite others by e-mail, or ask people already on the platform to connect. */
  get allowEmailInvitations() {
    return s<boolean>("signin.emailInvitations");
  },
  /** E-mail domains that may sign up or be invited (all when empty). */
  get emailDomains() {
    return s<string[]>("signin.emailDomains");
  },
  /**
   * Administrators of the instance, by e-mail address (lower case). Only e-mail accounts (address proven by a sign-in
   * link), Outline accounts of OUTLINE_URL and accounts of the OIDC provider vouching for the address count: another
   * Outline server could claim any address.
   */
  adminEmails: (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
  /** Lets outgoing webhooks reach internal addresses and plain http (a receiver on the same network, tests). */
  webhookAllowPrivate: process.env.WEBHOOK_ALLOW_PRIVATE === "true",
  /**
   * Web Push: the server's VAPID key pair (base64url, as `npx web-push generate-vapid-keys` prints them), set in the
   * environment or in Administration › Settings. Without them, a key is derived from APP_SECRET. The subject is a
   * contact for push services (mailto: or https:), falling back to the app's URL.
   */
  get vapidPublicKey() {
    return s<string>("push.vapidPublicKey");
  },
  get vapidPrivateKey() {
    return s<string>("push.vapidPrivateKey");
  },
  get vapidSubject() {
    return s<string>("push.vapidSubject") || (appUrl.startsWith("https:") ? appUrl : "mailto:admin@localhost");
  },
  /**
   * Company sign-in with OpenID Connect, for accounts without Outline (oidc.ts): the provider (issuer URL), the
   * client registered there, the button's label and the scopes asked. OIDC_ALLOWED_DOMAINS limits sign-in to some
   * e-mail domains; OIDC_ENABLED=false turns it off even when configured.
   */
  // (Setters are for the tests: they override the setting.)
  oidc: {
    get issuer() {
      return trimSlash(s<string>("oidc.issuer"));
    },
    set issuer(v: string) {
      overrideSetting("oidc.issuer", v);
    },
    get clientId() {
      return s<string>("oidc.clientId");
    },
    set clientId(v: string) {
      overrideSetting("oidc.clientId", v);
    },
    get clientSecret() {
      return s<string>("oidc.clientSecret");
    },
    set clientSecret(v: string) {
      overrideSetting("oidc.clientSecret", v);
    },
    get name() {
      return s<string>("oidc.name");
    },
    set name(v: string) {
      overrideSetting("oidc.name", v);
    },
    get scopes() {
      return s<string>("oidc.scopes");
    },
    set scopes(v: string) {
      overrideSetting("oidc.scopes", v);
    },
    get allowedDomains() {
      return s<string[]>("oidc.allowedDomains");
    },
    set allowedDomains(v: string[]) {
      overrideSetting("oidc.allowedDomains", v);
    },
    get enabled() {
      return Boolean(s<boolean>("oidc.enabled") && this.issuer && this.clientId);
    },
    set enabled(v: boolean) {
      overrideSetting("oidc.enabled", v);
    },
  },
  /** Redis holding the rate limit counters (shared by every instance); without it, they are kept in memory. */
  redisUrl: process.env.REDIS_URL || "",
  /** Each new offence multiplies the time a client is blocked by this factor (1: always the same). */
  rateLimitBackoffFactor: Math.max(1, Number(process.env.RATE_LIMIT_BACKOFF_FACTOR || 2) || 2),
  /** Sending e-mails (invitations, sign-in links). Without SMTP_HOST, nothing is sent. */
  smtp: {
    get host() {
      return s<string>("smtp.host");
    },
    get port() {
      return Number(s<number>("smtp.port")) || 587;
    },
    get secure() {
      return s<boolean | null>("smtp.secure") ?? this.port === 465;
    },
    get user() {
      return s<string>("smtp.user");
    },
    get pass() {
      return s<string>("smtp.pass");
    },
    get from() {
      return s<string>("smtp.from") || this.user;
    },
  },
};

if (!config.databaseUrl) throw new Error("DATABASE_URL is required");
if (config.appSecret.length < 32) {
  throw new Error("APP_SECRET is required and must be at least 32 characters");
}
