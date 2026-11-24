/**
 * Reports published to Outline as Markdown documents under a parent document: the daily activity of a pipe, the
 * weekly time report (pipes with time reports) and the report of a closed sprint.
 *
 * - By hand, from a report, with the person's own Outline session.
 * - Automatically, when a pipe asks for it: the daily activity at REPORT_HOUR, the weekly time report on Fridays at
 *   that hour (under its own parent when one is set), and each sprint as it closes. This uses the Outline account
 *   of a member, kept encrypted: an API key they give, or their account connected with OAuth for this pipe, with
 *   its own tokens refreshed here (a token copied from a session would die at that session's next refresh). Only
 *   that member may point it at other documents. When Outline refuses it, publishing stops until a new key or
 *   connection is given, and that member is told by e-mail, once.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { handleOutlineGrant, outlineGrant, startOutlineGrant } from "./auth.js";
import { decrypt, encrypt } from "./crypto-box.js";
import { one, query, tx, type Row } from "./db.js";
import { bad, forbidden, HttpError, notFound } from "./errors.js";
import { TASK_KEY_PREFIX } from "./git.js";
import { intlTag, localeOf, localize, tr, type Locale } from "./i18n.js";
import { escape, mailEnabled, mailLayout, sendHtmlMail } from "./mail.js";
import {
  absoluteOutlineUrl, outlineApi, OutlineError, outlineToken, type OAuthTokens, type OutlineCall, type OutlineDocument,
} from "./outline.js";
import { pipeTypeById, stageLabel, taskTypeById } from "./pipeTypes.js";
import { dailyPeriod, lastWeekday, localDay, zonedParts } from "./time.js";
import {
  claim, duration, latestReportWeek, pipeDailyReport, pipeWeeklyReport, workDuration, type DailyReport, type ReportTask, type TaskInfo, type WeeklyReport,
} from "./reports.js";

export interface PublishedDoc {
  id: string;
  title: string;
  url: string | null;
}

// ---------------------------------------------------------------------------
// Markdown

/** Escapes the characters Markdown would read as formatting in a line of text. */
export const md = (s: string) => s.replace(/[\\`*_{}[\]<>()#+|!~]/g, (c) => `\\${c}`).replace(/\s*\n\s*/g, " ");

/**
 * The same, for text that starts a paragraph: also escapes what would open a list, a rule or a heading there
 * ("1. ", "- ", "---", "==="), which `md` leaves alone inside a line.
 */
export const mdBlock = (s: string) => md(s.trim()).replace(/^(\d+)([.)])(?=\s|$)/, "$1\\$2").replace(/^([-=])/, "\\$1");

const longDay = (d: string, lang: Locale) =>
  new Intl.DateTimeFormat(intlTag(lang), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${d.slice(0, 10)}T00:00:00Z`));

const when = (iso: string, lang: Locale) =>
  new Intl.DateTimeFormat(intlTag(lang), { timeZone: config.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso));

/** A timestamp from the database as ISO text (null stays null). */
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : ((d as string | null) ?? null));

/** A date column as a day ("2026-11-24"). */
const isoDay = (d: unknown) => (iso(d) ?? "").slice(0, 10);

const taskLine = (lang: Locale, kind: string, t: ReportTask | TaskInfo, extra = "") => {
  const stage = "stage" in t && t.stage ? ` · ${md(localize(lang, stageLabel(kind, t.stage) ?? t.stage))}` : "";
  return `- [${TASK_KEY_PREFIX}-${t.number}](${config.appUrl}/?task=${t.id}) ${md(t.title)}${stage}${t.owner ? ` · ${md(t.owner)}` : ""}${extra}`;
};

const mdTable = (head: string[], body: string[][]) =>
  `| ${head.join(" | ")} |\n|${head.map((_, i) => (i ? " ---: " : " --- ")).join("|")}|\n${body.map((row) => `| ${row.join(" | ")} |`).join("\n")}`;

const backLink = (lang: Locale, pipe: Row) =>
  `\n---\n\n${tr(lang, "Published by TasksPipes from the pipe [{pipe}]({url}).", { pipe: md(pipe.name), url: `${config.appUrl}/pipes/${pipe.id}` })}\n`;

/** The daily activity of a pipe as a document; `empty` when nothing happened. */
export function dailyDocument(pipe: Row, r: DailyReport, lang: Locale, reportDay: string) {
  const sections: [string, ReportTask[]][] = [
    [tr(lang, "New in the pipe"), r.created], [tr(lang, "Tasks started"), r.started], [tr(lang, "Tasks done"), r.done],
    [tr(lang, "Tasks blocked"), r.blocked], [tr(lang, "Tasks dropped"), r.dropped],
    [tr(lang, "Still in progress"), r.inProgress], [tr(lang, "Still blocked"), r.stillBlocked],
  ];
  const shown = sections.filter(([, list]) => list.length);
  const body = shown.map(([title, list]) => `## ${md(title)} (${list.length})\n\n${list.map((t) => taskLine(lang, pipe.kind, t)).join("\n")}`).join("\n\n");
  return {
    title: tr(lang, "Activity of {pipe} — {day}", { pipe: pipe.name, day: longDay(reportDay, lang) }),
    text: `${tr(lang, "From {start} to {end}.", { start: when(r.period.start, lang), end: when(r.period.end, lang) })}\n\n`
      + (body || tr(lang, "Nothing happened in this pipe during this period.")) + "\n" + backLink(lang, pipe),
    empty: !shown.length,
  };
}

/** The weekly time report of a pipe as a document; `empty` when no time was spent nor logged. */
export function weeklyDocument(pipe: Row, r: WeeklyReport, lang: Locale, reportDay: string) {
  const byType = r.byType.length
    ? mdTable(
      [tr(lang, "Task type"), tr(lang, "In progress"), tr(lang, "Blocked"), tr(lang, "Tasks"), tr(lang, "Done")],
      r.byType.map((row) => [md(localize(lang, taskTypeById(row.taskType)?.label ?? row.taskType)), duration(row.activeMs, lang), duration(row.blockedMs, lang), String(row.tasks), String(row.done)]),
    )
    : tr(lang, "No time recorded this week.");
  const top = r.tasks.length
    ? `\n\n## ${md(tr(lang, "Tasks that took the most time"))}\n\n${r.tasks.slice(0, 10).map((t) => taskLine(lang, pipe.kind, t, ` · ${duration(t.activeMs, lang)}`)).join("\n")}`
    : "";
  // Durations only: notes stay in the app.
  const logged = r.logged?.totalMinutes
    ? `\n\n## ${md(tr(lang, "Time logged: {total}", { total: workDuration(r.logged.totalMinutes, lang) }))}\n\n`
      + `${r.logged.byPerson.map((p) => `${md(p.name)} ${workDuration(p.minutes, lang)}`).join(" · ")}\n\n`
      + r.logged.tasks.slice(0, 10).map((t) => taskLine(lang, pipe.kind, t, ` · ${workDuration(t.minutes, lang)}`
        + (t.estimateMinutes ? ` · ${md(tr(lang, "{logged} of {estimate} estimated", { logged: workDuration(t.totalMinutes, lang), estimate: workDuration(t.estimateMinutes, lang) }))}` : ""))).join("\n")
    : "";
  return {
    title: tr(lang, "Time report of {pipe} — week to {day}", { pipe: pipe.name, day: longDay(reportDay, lang) }),
    text: `${tr(lang, "Time spent on tasks being worked on, from {start} to {end}: {total}.", { start: when(r.period.start, lang), end: when(r.period.end, lang), total: duration(r.totalActiveMs, lang) })}\n\n`
      + byType + top + logged + "\n" + backLink(lang, pipe),
    empty: !r.tasks.length && !r.logged?.totalMinutes,
  };
}

interface DoneBy {
  key: string;
  done: number;
  donePoints: number;
  tasks: number;
  points: number;
}

interface SprintReport {
  committed?: number;
  completed?: number;
  done?: number;
  carried?: number;
  carriedPoints?: number;
  abandoned?: number;
  carriedTo?: { name: string } | null;
  scopeStart?: number;
  scopeEnd?: number;
  byOwner?: DoneBy[];
  byType?: DoneBy[];
  velocity?: { value: number | null; source: string };
}

/** The report of a closed sprint as a document. */
export function sprintDocument(pipe: Row, sprint: Row, lang: Locale) {
  const r = (sprint.report ?? {}) as SprintReport;
  const pts = (n: number) => tr(lang, "{n} pts", { n });
  const tasks = (n: number) => tr(lang, "{n} tasks", { n });
  const rows: [string, string][] = [
    [tr(lang, "Committed"), pts(r.committed ?? 0)],
    [tr(lang, "Done"), `${pts(r.completed ?? 0)} · ${tasks(r.done ?? 0)}`],
    [tr(lang, "Carried over"), `${pts(r.carriedPoints ?? 0)} · ${tasks(r.carried ?? 0)}${r.carriedTo ? ` → ${md(r.carriedTo.name)}` : ""}`],
  ];
  if (r.abandoned) rows.push([tr(lang, "Tasks dropped"), String(r.abandoned)]);
  if (r.scopeStart !== undefined && r.scopeEnd !== undefined && r.scopeEnd !== r.scopeStart) {
    const added = r.scopeEnd - r.scopeStart;
    rows.push([tr(lang, "Added during the sprint"), `${added > 0 ? "+" : ""}${pts(added)}`]);
  }
  if (r.velocity?.value !== null && r.velocity?.value !== undefined) rows.push([tr(lang, "Velocity for the next sprints"), pts(r.velocity.value)]);
  const by = (title: string, list: DoneBy[] | undefined, name: (key: string) => string) =>
    list?.length
      ? `\n\n## ${md(title)}\n\n${mdTable(["", tr(lang, "Points done"), tr(lang, "Tasks done")], list.map((o) => [md(name(o.key)), `${o.donePoints} / ${o.points}`, `${o.done} / ${o.tasks}`]))}`
      : "";
  const goal = sprint.goal ? `## ${md(tr(lang, "Sprint goal"))}\n\n${mdBlock(sprint.goal)}\n\n` : "";
  return {
    title: tr(lang, "{sprint} of {pipe} — report", { sprint: sprint.name, pipe: pipe.name }),
    text: `${tr(lang, "From {start} to {end}.", { start: longDay(isoDay(sprint.starts_on), lang), end: longDay(isoDay(sprint.ends_on), lang) })}\n\n`
      + goal
      + mdTable([tr(lang, "Sprint"), md(sprint.name)], rows.map(([k, v]) => [md(k), v]))
      + by(tr(lang, "Done per person"), r.byOwner, (k) => k || tr(lang, "Unassigned"))
      + by(tr(lang, "Done per task type"), r.byType, (k) => localize(lang, taskTypeById(k)?.label ?? k))
      + "\n" + backLink(lang, pipe),
  };
}

/** The title as Outline keeps it (100 characters at most). */
const outlineTitle = (title: string) => title.slice(0, 100);

const published = (d: OutlineDocument, instance: string): PublishedDoc => ({ id: d.id, title: d.title, url: absoluteOutlineUrl(d.url, instance) });

/** Creates the document under its parent, published. */
export async function publish(call: OutlineCall, parentDocumentId: string, doc: { title: string; text: string }, instance: string): Promise<PublishedDoc> {
  const { data } = await call<OutlineDocument>("documents.create", { title: outlineTitle(doc.title), text: doc.text, parentDocumentId, publish: true });
  return published(data, instance);
}

/**
 * The document already under the parent with this title, if any. Before trying again: Outline may have created the
 * document of a failed attempt and answered too late.
 */
async function alreadyPublished(call: OutlineCall, parentDocumentId: string, title: string, instance: string): Promise<PublishedDoc | null> {
  const { data } = await call<OutlineDocument[]>("documents.list", { parentDocumentId, sort: "createdAt", direction: "DESC", limit: 25 });
  const found = data.find((d) => d.title === outlineTitle(title));
  return found ? published(found, instance) : null;
}

// ---------------------------------------------------------------------------
// Automatic publishing of a pipe

export interface ExportSettings {
  parentDocId: string;
  parentDocTitle: string;
  parentDocUrl: string | null;
  outlineUser: string | null;
  /** "oauth": a member's Outline account connected for this pipe; "key": an API key they gave. */
  connection: "oauth" | "key";
  daily: boolean;
  weekly: boolean;
  /** Where the weekly time report goes, when not under the main parent. */
  weeklyParentDocId: string | null;
  weeklyParentDocTitle: string | null;
  weeklyParentDocUrl: string | null;
  sprints: boolean;
  setBy: string | null;
  /** The key was given by the person who reads the settings: only they may point it at other documents. */
  mine: boolean;
  /** The member who gave the key left the space (or their account was closed): nothing is published until a new key. */
  ownerGone: boolean;
  keyRefused: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  lastExportAt: string | null;
  lastExportUrl: string | null;
}

const present = (r: Row, viewerId: string): ExportSettings => ({
  parentDocId: r.parent_doc_id,
  parentDocTitle: r.parent_doc_title,
  parentDocUrl: r.parent_doc_url,
  outlineUser: r.outline_user,
  connection: r.oauth ? "oauth" : "key",
  daily: r.daily,
  weekly: r.weekly,
  weeklyParentDocId: r.weekly_parent_doc_id,
  weeklyParentDocTitle: r.weekly_parent_doc_title,
  weeklyParentDocUrl: r.weekly_parent_doc_url,
  sprints: r.sprints,
  setBy: r.created_by_name ?? null,
  mine: r.created_by === viewerId,
  ownerGone: !r.owner_active,
  keyRefused: r.key_refused,
  lastError: r.last_error,
  lastErrorAt: iso(r.last_error_at),
  lastExportAt: iso(r.last_export_at),
  lastExportUrl: r.last_export_url,
});

/** Outline refuses the key itself (revoked, expired, or no longer allowed to write there). */
const refused = (err: unknown) => err instanceof OutlineError && [401, 403].includes(err.status);

/** Outline did not answer in time, could not be reached, or failed on its side: worth trying again later. */
const transient = (err: unknown) => err instanceof OutlineError && (err.status >= 500 || err.status === 429);

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

/** An Outline account given for a pipe: an API key, or the tokens of an OAuth connection. */
interface Account {
  token: string;
  instance: string;
  oauth: boolean;
  refreshToken: string | null;
  expiresAt: Date | null;
}

/** An access token this close to its end is refreshed before use. */
const EXPIRY_MARGIN_MS = 60_000;

const expiryOf = (t: OAuthTokens) => (t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null);

/**
 * A fresh access token for a pipe's OAuth connection. Outline replaces the refresh token at each refresh, so two
 * refreshes at once would leave one of them with a dead token: the row is locked, and a token another pass refreshed
 * meanwhile is used as is. A refresh Outline refuses (connection revoked or expired) counts as a refused key.
 */
async function refreshGrant(pipeId: string, stale: string | null): Promise<string> {
  return tx(async (db) => {
    const { rows: [r] } = await db.query(`SELECT api_key, refresh_token FROM pipe_outline_exports WHERE pipe_id = $1 FOR UPDATE`, [pipeId]);
    const current = decrypt(r?.api_key);
    if (current && current !== stale) return current;
    const refreshToken = decrypt(r?.refresh_token);
    if (!refreshToken) throw new OutlineError(401, "The Outline connection cannot be renewed");
    let t: OAuthTokens;
    try {
      t = await outlineToken({ grant_type: "refresh_token", refresh_token: refreshToken });
    } catch (err) {
      if (err instanceof OutlineError && err.status >= 400 && err.status < 500 && err.status !== 429) throw new OutlineError(401, err.message);
      throw err;
    }
    await db.query(
      `UPDATE pipe_outline_exports SET api_key = $2, refresh_token = $3, token_expires_at = $4 WHERE pipe_id = $1`,
      [pipeId, encrypt(t.access_token), encrypt(t.refresh_token || refreshToken), expiryOf(t)]
    );
    return t.access_token;
  });
}

/** Calls Outline with a pipe's stored account; an OAuth connection's access token is refreshed when it ends. */
function callerFor(row: Row): OutlineCall {
  const instance: string = row.outline_url;
  let token = decrypt(row.api_key);
  let expiresAt: number | null = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;
  const refresh = async () => {
    token = await refreshGrant(row.pipe_id, token);
    expiresAt = null;
  };
  return async (method, body) => {
    if (!token) throw new Error("Outline API key unreadable");
    if (row.oauth && expiresAt !== null && expiresAt < Date.now() + EXPIRY_MARGIN_MS) await refresh();
    try {
      return await outlineApi(token!, method, body, instance);
    } catch (err) {
      if (!(row.oauth && err instanceof OutlineError && err.status === 401)) throw err;
      await refresh();
      return outlineApi(token!, method, body, instance);
    }
  };
}

interface PublishOptions {
  /** The parent document; the pipe's main one by default. */
  parentId?: string;
  /** The clock of the run, for the times recorded. */
  now?: Date;
  /** An attempt of this period failed: look for its document before creating another one. */
  retrying?: boolean;
}

/** Publishes with the pipe's key; records the outcome, and tells the person who set it up when the key is refused. */
async function publishForPipe(row: Row, pipe: Row, doc: { title: string; text: string }, options: PublishOptions = {}) {
  const { parentId = row.parent_doc_id as string, now = new Date(), retrying = false } = options;
  const instance: string = row.outline_url;
  try {
    const call = callerFor(row);
    const out = (retrying && (await alreadyPublished(call, parentId, doc.title, instance))) || (await publish(call, parentId, doc, instance));
    await query(
      `UPDATE pipe_outline_exports SET last_export_at = $3, last_export_url = $2, last_error = NULL, last_error_at = NULL WHERE pipe_id = $1`,
      [pipe.id, out.url, now]
    );
    return out;
  } catch (err) {
    throw await recordFailure(row, pipe, err, now);
  }
}

/** Records a failure in the pipe's settings; a refused account stops the publishing, and its giver is told, once. */
async function recordFailure(row: Row, pipe: Row, err: unknown, now: Date): Promise<unknown> {
  const message = messageOf(err);
  const keyRefused = refused(err);
  await query(
    `UPDATE pipe_outline_exports SET last_error = $2, last_error_at = $4, key_refused = key_refused OR $3 WHERE pipe_id = $1`,
    [pipe.id, message, keyRefused, now]
  );
  if (keyRefused && !row.key_refused) {
    const mailError = await warnOwner(row, pipe, message).then(() => null, (e: unknown) => e);
    if (mailError) return new Error(`${message} (the e-mail telling of it was not sent: ${messageOf(mailError)})`, { cause: err });
  }
  return err;
}

async function warnOwner(row: Row, pipe: Row, message: string) {
  if (!mailEnabled() || !row.created_by) return;
  const u = await one(`SELECT email, locale FROM users WHERE id = $1 AND disabled_at IS NULL AND email IS NOT NULL`, [row.created_by]);
  if (!u) return;
  const lang: Locale = u.locale ?? config.defaultLocale;
  const title = tr(lang, "Reports of {pipe} are no longer published to Outline", { pipe: pipe.name });
  await sendHtmlMail(lang, u.email, title, mailLayout(lang, {
    title,
    intro: row.oauth
      ? tr(lang, "Outline ended the connection made for this pipe: {error}", { error: message })
      : tr(lang, "Outline refused the API key given for this pipe: {error}", { error: message }),
    body: `<p>${escape(row.oauth
      ? tr(lang, "Connect the Outline account again in the pipe's reports (Outline section) to start again.")
      : tr(lang, "Give a new key in the pipe's reports (Outline section) to start again."))}</p>`,
    action: { label: tr(lang, "Open the pipe"), url: `${config.appUrl}/pipes/${pipe.id}` },
    footer: escape(tr(lang, "You receive this e-mail because you set up the publishing of this pipe's reports to Outline.")),
  }));
}

/** Writes a pipe's settings (columns named in code); new settings clear the last error and a refused key. */
async function saveSettings(pipeId: string, values: Record<string, unknown>) {
  const columns = Object.keys(values);
  const params = [pipeId, ...Object.values(values)];
  const set = `${columns.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now(), key_refused = false, last_error = NULL, last_error_at = NULL`;
  // Settings changed without an account keep the stored one (an INSERT would need it); a new pipe's come with one.
  const { rowCount } = await query(`UPDATE pipe_outline_exports SET ${set} WHERE pipe_id = $1`, params);
  if (rowCount) return;
  await query(
    `INSERT INTO pipe_outline_exports (pipe_id, ${columns.join(", ")}) VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(", ")})
     ON CONFLICT (pipe_id) DO UPDATE SET ${set}`,
    params
  );
}

/**
 * The key publishes while the member who gave it is still in the pipe's space, with an active account (`e` the
 * settings, `p` the pipe): it is their Outline account, not the space's.
 */
const OWNER_ACTIVE = `EXISTS (SELECT 1 FROM space_members sm JOIN users ou ON ou.id = sm.user_id
  WHERE sm.space_id = p.space_id AND sm.user_id = e.created_by AND ou.disabled_at IS NULL)`;

const settingsOf = (pipeId: string) =>
  one(
    `SELECT e.*, u.name AS created_by_name, ${OWNER_ACTIVE} AS owner_active
     FROM pipe_outline_exports e JOIN pipes p ON p.id = e.pipe_id LEFT JOIN users u ON u.id = e.created_by WHERE e.pipe_id = $1`,
    [pipeId]
  );

/** Publishes a sprint just closed, when its pipe asks for it. */
export async function exportSprintToOutline(pipe: Row, sprint: Row): Promise<PublishedDoc | null> {
  const row = await settingsOf(pipe.id);
  if (!row?.sprints || row.key_refused || !row.owner_active || !config.outlineEnabled) return null;
  return publishForPipe(row, pipe, sprintDocument(pipe, sprint, row.locale ?? config.defaultLocale));
}

/** What a scheduled pass did: the documents created, and the pipes it could not publish (for the logs). */
export interface ScheduledRun {
  published: number;
  failed: { pipeId: string; message: string }[];
}

/** A pipe whose attempt failed for a passing reason is tried again after this long. */
const RETRY_AFTER_MS = 10 * 60_000;

/**
 * Publishes the daily activity of the pipes that ask for it once the report hour has passed, and on Fridays the
 * weekly time report (call it every minute). Each pipe's period is claimed once; days with no activity are skipped.
 * When Outline fails for a passing reason, the claim is given back and the pipe tried again after RETRY_AFTER_MS,
 * until midnight: the report day comes from `now`, so a period still failing then is not tried anymore (its error
 * stays in the pipe's settings).
 */
export async function runScheduledOutlineExports(now = new Date()): Promise<ScheduledRun> {
  const run: ScheduledRun = { published: 0, failed: [] };
  if (!config.outlineEnabled) return run;
  const reportDay = localDay(now, config.timezone);
  const end = dailyPeriod(reportDay, config.reportHour, config.timezone).end;
  if (now < end) return run;
  await publishDue(run, "daily", now, reportDay, end);
  if (zonedParts(now, config.timezone).weekday === "Fri") await publishDue(run, "weekly", now, reportDay, end);
  return run;
}

async function publishDue(run: ScheduledRun, kind: "daily" | "weekly", now: Date, reportDay: string, end: Date) {
  const prefix = `outline-${kind}:`;
  // Not done for this period, and not failed in the last minutes. last_error_at is also written when a sprint is
  // published: such a failure delays the next attempt too.
  const { rows } = await query(
    `SELECT e.*, p.name, p.kind FROM pipe_outline_exports e JOIN pipes p ON p.id = e.pipe_id
     WHERE ${kind === "daily" ? "e.daily" : "e.weekly"} AND NOT e.key_refused AND p.archived_at IS NULL AND ${OWNER_ACTIVE}
       AND (e.last_error_at IS NULL OR e.last_error_at <= $2)
       AND NOT EXISTS (SELECT 1 FROM report_runs r WHERE r.kind = $1::text || e.pipe_id::text AND r.period_end = $3)`,
    [prefix, new Date(now.getTime() - RETRY_AFTER_MS), end]
  );
  for (const row of rows) {
    const pipe = { id: row.pipe_id, name: row.name, kind: row.kind };
    if (kind === "weekly" && !pipeTypeById(pipe.kind)?.timeReport) continue;
    const runKind = prefix + pipe.id;
    if (!(await claim(runKind, end))) continue;
    try {
      const lang: Locale = row.locale ?? config.defaultLocale;
      const doc = kind === "daily"
        ? dailyDocument(pipe, await pipeDailyReport(pipe.id, reportDay), lang, reportDay)
        : weeklyDocument(pipe, await pipeWeeklyReport(pipe.id, reportDay), lang, reportDay);
      if (doc.empty) continue;
      const parentId = kind === "weekly" ? (row.weekly_parent_doc_id ?? row.parent_doc_id) : row.parent_doc_id;
      // Failed since the report hour: Outline may have created that document anyway.
      const retrying = Boolean(row.last_error_at && row.last_error_at >= end);
      await publishForPipe(row, pipe, doc, { parentId, now, retrying });
      run.published++;
    } catch (err) {
      if (transient(err)) await query(`DELETE FROM report_runs WHERE kind = $1 AND period_end = $2`, [runKind, end]);
      run.failed.push({ pipeId: pipe.id, message: messageOf(err) });
    }
  }
}

/** An OAuth connection unused this long is refreshed, so that its refresh token does not expire unused. */
const KEEP_ALIVE_DAYS = 7;

/**
 * Refreshes the OAuth connections idle for KEEP_ALIVE_DAYS (a pipe that only publishes its sprints, or the weekly
 * report): call it every hour. Returns the pipes that failed; a connection Outline ended stops as a refused key.
 */
export async function refreshIdleOutlineConnections(now = new Date()): Promise<ScheduledRun["failed"]> {
  const failed: ScheduledRun["failed"] = [];
  if (!config.outlineEnabled || !config.oauthEnabled) return failed;
  const { rows } = await query(
    `SELECT e.*, p.name FROM pipe_outline_exports e JOIN pipes p ON p.id = e.pipe_id
     WHERE e.oauth AND NOT e.key_refused AND p.archived_at IS NULL AND ${OWNER_ACTIVE}
       AND e.token_expires_at < $1::timestamptz - make_interval(days => $2)`,
    [now, KEEP_ALIVE_DAYS]
  );
  for (const row of rows) {
    try {
      await refreshGrant(row.pipe_id, decrypt(row.api_key));
    } catch (err) {
      const recorded = await recordFailure(row, { id: row.pipe_id, name: row.name }, err, now);
      failed.push({ pipeId: row.pipe_id, message: messageOf(recorded) });
    }
  }
  return failed;
}

// ---------------------------------------------------------------------------
// Routes

type Req = FastifyRequest<{ Params: Record<string, string>; Body: Record<string, unknown> | undefined }>;

export interface OutlineReportDeps {
  loadPipeFor: (id: unknown, userId: string) => Promise<{ p: Row; role: string | null }>;
  /** The latest finished report day. */
  latestReportDay: () => string;
  /** A valid day from a request, else the fallback. */
  reportDay: (v: unknown, fallback: string) => string;
}

/** A document id, a url-id ("title-AbC123"), or a document's address. */
export function docId(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  const id = s.match(/\/doc\/([^/?#]+)/)?.[1] ?? s;
  if (!id || id.length > 200 || !/^[\w-]+$/.test(id)) throw bad("Choose the parent document in Outline");
  return id;
}

/** The kind of the OAuth flows that connect a pipe's publishing (see auth.ts). */
const CONNECT = "outline-export";

const SPRINT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function outlineReportRoutes(app: FastifyInstance, deps: OutlineReportDeps) {
  const me = (req: FastifyRequest) => req.user!.id;
  const enabled = () => {
    if (!config.outlineEnabled) throw bad("Outline is turned off on this instance");
  };

  /** The parent asked for (resolved to its id: it may be an address), else the one the pipe publishes under. */
  async function parentFor(req: Req, pipeId: string, weekly = false) {
    if (req.body?.parentDocumentId) {
      const { data } = await req.outline<OutlineDocument>("documents.info", { id: docId(req.body.parentDocumentId) });
      return data.id;
    }
    const row = await one(`SELECT parent_doc_id, weekly_parent_doc_id FROM pipe_outline_exports WHERE pipe_id = $1`, [pipeId]);
    if (!row) throw bad("Choose the parent document in Outline");
    return ((weekly && row.weekly_parent_doc_id) || row.parent_doc_id) as string;
  }

  // By hand: the daily activity of a day, with one's own Outline account.
  app.post("/pipes/:id/reports/daily/outline", async (req: Req) => {
    enabled();
    const { p } = await deps.loadPipeFor(req.params.id, me(req));
    const reportDay = deps.reportDay(req.body?.date, deps.latestReportDay());
    const doc = dailyDocument(p, await pipeDailyReport(p.id, reportDay), localeOf(req), reportDay);
    return publish(req.outline, await parentFor(req, p.id), doc, req.outlineUrl);
  });

  // By hand: the weekly time report of a week ending on a Friday (pipes with time reports).
  app.post("/pipes/:id/reports/weekly/outline", async (req: Req) => {
    enabled();
    const { p } = await deps.loadPipeFor(req.params.id, me(req));
    if (!pipeTypeById(p.kind)?.timeReport) throw bad("This pipe has no weekly time report");
    const reportDay = lastWeekday(deps.reportDay(req.body?.date, latestReportWeek()), 5);
    const doc = weeklyDocument(p, await pipeWeeklyReport(p.id, reportDay), localeOf(req), reportDay);
    return publish(req.outline, await parentFor(req, p.id, true), doc, req.outlineUrl);
  });

  // By hand: the report of a closed sprint.
  app.post("/sprints/:id/report/outline", async (req: Req) => {
    enabled();
    const s = SPRINT_ID.test(req.params.id) ? await one(`SELECT * FROM sprints WHERE id = $1`, [req.params.id]) : null;
    if (!s) throw notFound("Sprint not found");
    const { p } = await deps.loadPipeFor(s.pipe_id, me(req));
    if (s.status !== "closed") throw bad("Only a closed sprint has a report");
    return publish(req.outline, await parentFor(req, p.id), sprintDocument(p, s, localeOf(req)), req.outlineUrl);
  });

  /** The pipe, for its publishing settings: a member of its space. */
  async function managedPipe(req: Req) {
    const { p, role } = await deps.loadPipeFor(req.params.id, me(req));
    if (!role) throw forbidden();
    return p;
  }

  app.get("/pipes/:id/outline-export", async (req: Req) => {
    const p = await managedPipe(req);
    const row = await settingsOf(p.id);
    return row ? present(row, me(req)) : null;
  });

  /**
   * Turns the automatic publishing on, or changes it, with the account `given` (a key typed, an OAuth connection just
   * made), else the current one. The account is checked against Outline, with the parent documents.
   */
  async function configure(p: Row, userId: string, lang: Locale, b: Record<string, unknown>, given: Account | null) {
    const current = await settingsOf(p.id);
    if (!given && !decrypt(current?.api_key)) throw bad("An Outline API key is required");
    const parent = b.parentDocumentId !== undefined ? docId(b.parentDocumentId) : current?.parent_doc_id;
    if (!parent) throw bad("Choose the parent document in Outline");
    // A new account works on its own Outline server; a kept one stays on its own.
    const instance: string = given ? given.instance : current!.outline_url;
    const call: OutlineCall = given ? (method, body) => outlineApi(given.token, method, body, instance) : callerFor(current!);
    const timeReport = Boolean(pipeTypeById(p.kind)?.timeReport);
    // The weekly report's own parent (pipes with time reports): kept when not given, cleared when empty.
    const weeklyParent = !timeReport ? null
      : b.weeklyParentDocumentId === undefined ? (current?.weekly_parent_doc_id ?? null)
        : b.weeklyParentDocumentId ? docId(b.weeklyParentDocumentId) : null;
    // A setting given in the request, else the current one.
    const flag = (name: "daily" | "weekly" | "sprints") => (name in b ? b[name] === true : Boolean(current?.[name]));
    // Someone else's account only writes where its owner chose: pointing it at other documents takes one's own.
    // Checked before asking Outline, which would otherwise tell what that account can reach.
    if (!given && current!.created_by !== userId) {
      const moved = (id: string | null, storedId: string | null, storedUrl: string | null) =>
        id !== null && id !== storedId && !storedUrl?.endsWith(`/doc/${id}`);
      if (moved(parent, current!.parent_doc_id, current!.parent_doc_url)
        || moved(weeklyParent, current!.weekly_parent_doc_id, current!.weekly_parent_doc_url)) {
        throw bad("Give your own Outline API key to change where this pipe publishes");
      }
    }
    let who: { user?: { name?: string } };
    let doc: OutlineDocument;
    let weeklyDoc: OutlineDocument | null = null;
    try {
      ({ data: who } = await call<{ user?: { name?: string } }>("auth.info"));
      ({ data: doc } = await call<OutlineDocument>("documents.info", { id: parent }));
      if (weeklyParent) ({ data: weeklyDoc } = await call<OutlineDocument>("documents.info", { id: weeklyParent }));
    } catch (err) {
      if (err instanceof OutlineError && [401, 403, 404].includes(err.status)) {
        throw bad("Outline refused this key or this document: {error}", { error: err.message });
      }
      throw err;
    }
    await saveSettings(p.id, {
      // A kept account is not written back: its tokens may have been refreshed meanwhile.
      ...(given ? {
        outline_url: instance,
        api_key: encrypt(given.token),
        oauth: given.oauth,
        refresh_token: encrypt(given.refreshToken),
        token_expires_at: given.expiresAt,
      } : {}),
      outline_user: who.user?.name?.slice(0, 200) ?? null,
      // Who is told when the account is refused: the person who gave it.
      created_by: given ? userId : (current!.created_by ?? userId),
      locale: lang,
      parent_doc_id: doc.id,
      parent_doc_title: doc.title.slice(0, 500),
      parent_doc_url: absoluteOutlineUrl(doc.url, instance),
      weekly_parent_doc_id: weeklyDoc?.id ?? null,
      weekly_parent_doc_title: weeklyDoc?.title.slice(0, 500) ?? null,
      weekly_parent_doc_url: weeklyDoc ? absoluteOutlineUrl(weeklyDoc.url, instance) : null,
      daily: flag("daily"),
      weekly: timeReport && flag("weekly"),
      sprints: flag("sprints"),
    });
    return present((await settingsOf(p.id))!, userId);
  }

  // With an API key typed, or without one to change the documents or what is published.
  app.put("/pipes/:id/outline-export", async (req: Req) => {
    enabled();
    const p = await managedPipe(req);
    const b = req.body || {};
    const typed = typeof b.apiKey === "string" ? b.apiKey.trim() : "";
    if (typed.length > 500 || /\s/.test(typed)) throw bad("Invalid Outline API key");
    const given = typed ? { token: typed, instance: req.outlineUrl, oauth: false, refreshToken: null, expiresAt: null } : null;
    return configure(p, me(req), localeOf(req), b, given);
  });

  // With one's Outline account, connected with OAuth: returns Outline's authorization page; the choices of the form
  // travel with the flow, and are saved when Outline sends the person back (below).
  app.post("/pipes/:id/outline-export/connect", async (req: Req, reply) => {
    enabled();
    if (!config.oauthEnabled) throw bad("OAuth is not set up");
    // OAuth works with the configured server only, where the documents were chosen.
    if (req.outlineUrl !== config.outlineUrl) throw bad("Your Outline account is on another server: give an API key");
    const p = await managedPipe(req);
    const b = req.body || {};
    const choices = {
      parentDocumentId: docId(b.parentDocumentId),
      ...("weeklyParentDocumentId" in b ? { weeklyParentDocumentId: b.weeklyParentDocumentId ? docId(b.weeklyParentDocumentId) : "" } : {}),
      ...Object.fromEntries((["daily", "weekly", "sprints"] as const).filter((k) => k in b).map((k) => [k, b[k] === true])),
    };
    return { url: startOutlineGrant(req, reply, { kind: CONNECT, pipeId: p.id, userId: me(req), choices }) };
  });

  // Back from Outline: the person who started the connection, still signed in, still in the pipe's space.
  handleOutlineGrant(CONNECT, async (req, reply, flow, q) => {
    const pipeId = String(flow.pipeId);
    const lang = localeOf(req);
    const back = (params: Record<string, string>) => reply.redirect(`/pipes/${encodeURIComponent(pipeId)}?${new URLSearchParams(params)}`);
    try {
      if (q.error) return back({ outline_error: q.error_description || q.error });
      if (!req.user || req.user.id !== flow.userId) throw forbidden();
      if (!q.code) throw bad("Sign-in expired or interrupted, please try again.");
      enabled();
      const t = await outlineGrant(q.code);
      const { p, role } = await deps.loadPipeFor(pipeId, req.user.id);
      if (!role) throw forbidden();
      await configure(p, req.user.id, lang, flow.choices as Record<string, unknown>, {
        token: t.access_token, instance: config.outlineUrl, oauth: true, refreshToken: t.refresh_token ?? null, expiresAt: expiryOf(t),
      });
      return back({ outline: "connected" });
    } catch (err) {
      req.log.warn({ err, pipeId }, "Connecting a pipe's publishing to Outline failed");
      const known = err instanceof HttpError || err instanceof OutlineError;
      return back({ outline_error: known ? tr(lang, err.message, err.params) : tr(lang, "Connecting to Outline failed") });
    }
  });

  app.delete("/pipes/:id/outline-export", async (req: Req) => {
    const p = await managedPipe(req);
    await query(`DELETE FROM pipe_outline_exports WHERE pipe_id = $1`, [p.id]);
    return { ok: true };
  });
}
