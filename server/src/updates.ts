/**
 * New versions of TasksPipes: the latest release published on GitHub is checked every hour (unless turned off
 * in Administration › Settings, or by UPDATE_CHECK=false); when a newer one comes out, the instance's administrators
 * are told once, by e-mail and on their devices, and the About page shows it to everyone.
 */
import type { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { one, query } from "./db.js";
import { isInstanceAdmin, requestIsAdmin } from "./admin.js";
import { HttpError, bad, forbidden } from "./errors.js";
import { tr, type Locale } from "./i18n.js";
import { escape, mailLayout, sendHtmlMail, type MailTheme } from "./mail.js";
import { pushTo } from "./push.js";
import { setting } from "./settings-store.js";

export const REPOSITORY = "j33f/TasksPipes";

export interface Release {
  version: string;
  url: string;
  publishedAt: string | null;
}

/** "1.10.0" > "1.9.3"; a pre-release (1.0.0-rc.1) comes before its release. */
export function newer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number(n) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) > (y.nums[i] ?? 0);
  }
  if (x.pre === y.pre) return false;
  if (x.pre === null) return true;
  if (y.pre === null) return false;
  return x.pre > y.pre;
}

/** The latest release (pre-releases and drafts left out), or null when there is none. */
async function fetchLatest(): Promise<Release | null> {
  const res = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `TasksPipes/${config.version}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const r = (await res.json()) as { tag_name?: string; html_url?: string; published_at?: string };
  if (!r.tag_name || !/^v?\d+\.\d+\.\d+/.test(r.tag_name)) return null;
  return { version: r.tag_name.replace(/^v/, ""), url: r.html_url ?? `https://github.com/${REPOSITORY}/releases`, publishedAt: r.published_at ?? null };
}

type Send = (lang: Locale, to: string, subject: string, html: string) => Promise<unknown>;

/** What was last learnt (kept in memory: checked again at start). The fetcher can be replaced in tests. */
export const updateState: { latest: Release | null; checkedAt: Date | null; fetch: () => Promise<Release | null> } = {
  latest: null,
  checkedAt: null,
  fetch: fetchLatest,
};

export const updateCheckOn = () => setting<boolean>("updates.check");

export function updateEmail(lang: Locale, release: Release, theme: MailTheme = null) {
  const subject = tr(lang, "TasksPipes {version} is available", { version: release.version });
  return {
    subject,
    html: mailLayout(lang, {
      title: subject,
      intro: tr(lang, "This instance runs version {current}.", { current: config.version }),
      body: `<p style="margin:0">${escape(tr(lang, "Read what changed, then update the instance (see the hosting guide)."))}</p>`,
      action: { label: tr(lang, "See what's new"), url: release.url },
      footer: escape(tr(lang, "You receive this e-mail because you administer this TasksPipes instance.")),
      theme,
    }),
  };
}

/** The instance's administrators (named by ADMIN_EMAILS, proven accounts only), still enabled. */
export async function admins() {
  if (!config.adminEmails.length) return [];
  const { rows } = await query(
    `SELECT id, email, auth_kind, outline_url, oidc_issuer, oidc_email_verified, locale, theme FROM users
     WHERE lower(email) = ANY($1) AND disabled_at IS NULL`,
    [config.adminEmails]
  );
  return rows.filter(isInstanceAdmin);
}

/**
 * Checks for a newer release; the first time one is seen, its administrators are told (once per version, whatever
 * the number of instances running). Returns the version they were told of, if any.
 */
export async function checkForUpdate(send: Send = sendHtmlMail): Promise<string | null> {
  if (!updateCheckOn()) {
    updateState.latest = null;
    return null;
  }
  const latest = await updateState.fetch();
  updateState.latest = latest;
  updateState.checkedAt = new Date();
  if (!latest || !newer(latest.version, config.version)) return null;
  const first = await one(`INSERT INTO update_notices (version) VALUES ($1) ON CONFLICT DO NOTHING RETURNING version`, [latest.version]);
  if (!first) return null;
  for (const a of await admins()) {
    const lang = (a.locale as Locale) ?? config.defaultLocale;
    const mail = updateEmail(lang, latest, a.theme ?? null);
    await send(lang, a.email, mail.subject, mail.html).catch(() => {});
    await pushTo(a.id, { title: mail.subject, body: tr(lang, "This instance runs version {current}.", { current: config.version }), url: "/?about", tag: "update" }).catch(() => 0);
  }
  return latest.version;
}

// ---------------------------------------------------------------------------
// One-click updates: the app asks the updater service (updater/, holding the Docker socket) to move to a release.

export const updaterConfigured = () => Boolean(config.updaterUrl && config.updaterToken);

/** A call to the updater; its own errors become messages for the administrator. */
async function updater(method: "GET" | "POST", path: string, body?: object) {
  let res: Response;
  try {
    res = await fetch(`${config.updaterUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.updaterToken}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, "The updater cannot be reached.");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 409) throw bad("An update is already running.");
  if (res.status === 401) throw new HttpError(502, "The updater refused the token: UPDATER_TOKEN differs between the app and the updater.");
  if (!res.ok) throw new HttpError(502, "The updater answered with an error.");
  return json;
}

export async function updateRoutes(app: FastifyInstance) {
  // The version running and, when the check is on, the latest one published; whether I may update in one click.
  app.get("/version", async (req) => {
    const latest = updateCheckOn() ? updateState.latest : null;
    const updateAvailable = Boolean(latest && newer(latest.version, config.version));
    return {
      current: config.version,
      latest,
      updateAvailable,
      checkedAt: updateState.checkedAt,
      canUpdate: updateAvailable && updaterConfigured() && (await requestIsAdmin(req)),
    };
  });

  // Starts the update to the latest release (administrators; that version only, never one chosen freely).
  app.post("/admin/update", async (req) => {
    if (!(await requestIsAdmin(req))) throw forbidden();
    if (!updaterConfigured()) throw bad("One-click updates are not set up on this instance.");
    const version = (req.body as { version?: unknown } | undefined)?.version;
    const latest = updateState.latest;
    if (!latest || typeof version !== "string" || version !== latest.version || !newer(version, config.version)) {
      throw bad("Only the latest published version can be installed.");
    }
    req.log.info({ version, by: req.user!.id }, "Update started");
    await updater("POST", "/update", { version });
    return { ok: true };
  });

  // How the update goes; `current` changes once the new version answers.
  app.get("/admin/update", async (req) => {
    if (!(await requestIsAdmin(req))) throw forbidden();
    if (!updaterConfigured()) throw bad("One-click updates are not set up on this instance.");
    const s = await updater("GET", "/status");
    return { current: config.version, state: s.state, version: s.version, from: s.from, log: Array.isArray(s.log) ? s.log.slice(-20) : [] };
  });
}
