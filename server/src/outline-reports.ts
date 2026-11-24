/**
 * Reports published to Outline: the daily activity of a pipe and the report of a closed sprint, written as Markdown
 * documents under a parent document.
 *
 * Also the weekly time report of pipes with time reports. By hand, from a report, with the Outline account of the
 * person (their session). Automatically, when a pipe asks for it: the daily activity at REPORT_HOUR (once per day,
 * like the e-mails), the weekly time report on Fridays at that hour (under its own parent when one is set) and each
 * sprint as it closes. The
 * automatic publishing needs an Outline API key, given by whoever turns it on and kept encrypted: an OAuth token
 * copied from a session would die as soon as that session refreshes it. When Outline refuses the key, publishing
 * stops until a new key is given, and that person is told by e-mail, once.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { decrypt, encrypt } from "./crypto-box.js";
import { one, query, type Row } from "./db.js";
import { bad, forbidden, notFound } from "./errors.js";
import { TASK_KEY_PREFIX } from "./git.js";
import { intlTag, localeOf, localize, tr, type Locale } from "./i18n.js";
import { escape, mailEnabled, mailLayout, sendHtmlMail } from "./mail.js";
import { absoluteOutlineUrl, outlineApi, OutlineError, type OutlineDocument } from "./outline.js";
import { pipeTypeById, stageLabel, taskTypeById } from "./pipeTypes.js";
import { dailyPeriod, lastWeekday, localDay, zonedParts } from "./time.js";
import {
  claim, duration, latestReportWeek, pipeDailyReport, pipeWeeklyReport, workDuration, type DailyReport, type ReportTask, type TaskInfo, type WeeklyReport,
} from "./reports.js";

/** Calls an Outline API method as someone: the person's session, or the key of a pipe. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OutlineCall = <T = any>(method: string, body?: object) => Promise<{ data: T }>;

export interface PublishedDoc {
  id: string;
  title: string;
  url: string | null;
}

// ---------------------------------------------------------------------------
// Markdown

/** Escapes the characters Markdown would read as formatting in a line of text. */
export const md = (s: string) => s.replace(/[\\`*_{}[\]<>()#+|!~]/g, (c) => `\\${c}`).replace(/\s*\n\s*/g, " ");

const longDay = (d: string, lang: Locale) =>
  new Intl.DateTimeFormat(intlTag(lang), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${d.slice(0, 10)}T00:00:00Z`));

const when = (iso: string, lang: Locale) =>
  new Intl.DateTimeFormat(intlTag(lang), { timeZone: config.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso));

const isoDay = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

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
  const table = mdTable;
  const by = (title: string, list: DoneBy[] | undefined, name: (key: string) => string) =>
    list?.length
      ? `\n\n## ${md(title)}\n\n${table(["", tr(lang, "Points done"), tr(lang, "Tasks done")], list.map((o) => [md(name(o.key)), `${o.donePoints} / ${o.points}`, `${o.done} / ${o.tasks}`]))}`
      : "";
  const goal = sprint.goal ? `## ${md(tr(lang, "Sprint goal"))}\n\n${md(sprint.goal)}\n\n` : "";
  return {
    title: tr(lang, "{sprint} of {pipe} — report", { sprint: sprint.name, pipe: pipe.name }),
    text: `${tr(lang, "From {start} to {end}.", { start: longDay(isoDay(sprint.starts_on), lang), end: longDay(isoDay(sprint.ends_on), lang) })}\n\n`
      + goal
      + table([tr(lang, "Sprint"), md(sprint.name)], rows.map(([k, v]) => [md(k), v]))
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
  keyRefused: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  lastExportAt: string | null;
  lastExportUrl: string | null;
}

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : ((d as string | null) ?? null));

const present = (r: Row, viewerId: string): ExportSettings => ({
  parentDocId: r.parent_doc_id,
  parentDocTitle: r.parent_doc_title,
  parentDocUrl: r.parent_doc_url,
  outlineUser: r.outline_user,
  daily: r.daily,
  weekly: r.weekly,
  weeklyParentDocId: r.weekly_parent_doc_id,
  weeklyParentDocTitle: r.weekly_parent_doc_title,
  weeklyParentDocUrl: r.weekly_parent_doc_url,
  sprints: r.sprints,
  setBy: r.created_by_name ?? null,
  mine: r.created_by === viewerId,
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
    const key = decrypt(row.api_key);
    if (!key) throw new Error("Outline API key unreadable");
    const call: OutlineCall = (method, body) => outlineApi(key, method, body, instance);
    const out = (retrying && (await alreadyPublished(call, parentId, doc.title, instance))) || (await publish(call, parentId, doc, instance));
    await query(
      `UPDATE pipe_outline_exports SET last_export_at = $3, last_export_url = $2, last_error = NULL, last_error_at = NULL WHERE pipe_id = $1`,
      [pipe.id, out.url, now]
    );
    return out;
  } catch (err) {
    const message = messageOf(err);
    const keyRefused = refused(err);
    await query(
      `UPDATE pipe_outline_exports SET last_error = $2, last_error_at = $4, key_refused = key_refused OR $3 WHERE pipe_id = $1`,
      [pipe.id, message, keyRefused, now]
    );
    if (keyRefused && !row.key_refused) {
      const mailError = await warnOwner(row, pipe, message).then(() => null, (e: unknown) => e);
      if (mailError) throw new Error(`${message} (the e-mail telling of it was not sent: ${messageOf(mailError)})`, { cause: err });
    }
    throw err;
  }
}

async function warnOwner(row: Row, pipe: Row, message: string) {
  if (!mailEnabled() || !row.created_by) return;
  const u = await one(`SELECT email, locale FROM users WHERE id = $1 AND disabled_at IS NULL AND email IS NOT NULL`, [row.created_by]);
  if (!u) return;
  const lang: Locale = u.locale ?? config.defaultLocale;
  const title = tr(lang, "Reports of {pipe} are no longer published to Outline", { pipe: pipe.name });
  await sendHtmlMail(lang, u.email, title, mailLayout(lang, {
    title,
    intro: tr(lang, "Outline refused the API key given for this pipe: {error}", { error: message }),
    body: `<p>${escape(tr(lang, "Give a new key in the pipe's reports (Outline section) to start again."))}</p>`,
    action: { label: tr(lang, "Open the pipe"), url: `${config.appUrl}/pipes/${pipe.id}` },
    footer: escape(tr(lang, "You receive this e-mail because you set up the publishing of this pipe's reports to Outline.")),
  }));
}

const settingsOf = (pipeId: string) =>
  one(`SELECT e.*, u.name AS created_by_name FROM pipe_outline_exports e LEFT JOIN users u ON u.id = e.created_by WHERE e.pipe_id = $1`, [pipeId]);

/** Publishes a sprint just closed, when its pipe asks for it. */
export async function exportSprintToOutline(pipe: Row, sprint: Row): Promise<PublishedDoc | null> {
  const row = await settingsOf(pipe.id);
  if (!row?.sprints || row.key_refused || !config.outlineEnabled) return null;
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
     WHERE ${kind === "daily" ? "e.daily" : "e.weekly"} AND NOT e.key_refused AND p.archived_at IS NULL
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

const SPRINT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function outlineReportRoutes(app: FastifyInstance, deps: OutlineReportDeps) {
  const me = (req: FastifyRequest) => req.user!.id;
  const enabled = () => {
    if (!config.outlineEnabled) throw bad("Outline is turned off on this instance");
  };

  /** The parent asked for (resolved to its id: it may be an address), else the one the pipe publishes under. */
  async function parentFor(req: Req, pipeId: string, weekly = false) {
    if (req.body?.parentDocumentId) {
      const { data } = await (req.outline as OutlineCall)<OutlineDocument>("documents.info", { id: docId(req.body.parentDocumentId) });
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
    return publish(req.outline as OutlineCall, await parentFor(req, p.id), doc, req.outlineUrl);
  });

  // By hand: the weekly time report of a week ending on a Friday (pipes with time reports).
  app.post("/pipes/:id/reports/weekly/outline", async (req: Req) => {
    enabled();
    const { p } = await deps.loadPipeFor(req.params.id, me(req));
    if (!pipeTypeById(p.kind)?.timeReport) throw bad("This pipe has no weekly time report");
    const reportDay = lastWeekday(deps.reportDay(req.body?.date, latestReportWeek()), 5);
    const doc = weeklyDocument(p, await pipeWeeklyReport(p.id, reportDay), localeOf(req), reportDay);
    return publish(req.outline as OutlineCall, await parentFor(req, p.id, true), doc, req.outlineUrl);
  });

  // By hand: the report of a closed sprint.
  app.post("/sprints/:id/report/outline", async (req: Req) => {
    enabled();
    const s = SPRINT_ID.test(req.params.id) ? await one(`SELECT * FROM sprints WHERE id = $1`, [req.params.id]) : null;
    if (!s) throw notFound("Sprint not found");
    const { p } = await deps.loadPipeFor(s.pipe_id, me(req));
    if (s.status !== "closed") throw bad("Only a closed sprint has a report");
    return publish(req.outline as OutlineCall, await parentFor(req, p.id), sprintDocument(p, s, localeOf(req)), req.outlineUrl);
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

  // Turns the automatic publishing on, or changes it. The key is checked against Outline, with the parent document.
  app.put("/pipes/:id/outline-export", async (req: Req) => {
    enabled();
    const p = await managedPipe(req);
    const b = req.body || {};
    const current = await one(`SELECT * FROM pipe_outline_exports WHERE pipe_id = $1`, [p.id]);
    const typed = typeof b.apiKey === "string" ? b.apiKey.trim() : "";
    if (typed.length > 500 || /\s/.test(typed)) throw bad("Invalid Outline API key");
    // A new key works on the Outline server of one's account; a kept key stays on its own.
    const instance: string | undefined = typed ? req.outlineUrl : current?.outline_url;
    const key = typed || (current ? decrypt(current.api_key) : null);
    if (!key || !instance) throw bad("An Outline API key is required");
    const parent = b.parentDocumentId !== undefined ? docId(b.parentDocumentId) : current?.parent_doc_id;
    if (!parent) throw bad("Choose the parent document in Outline");
    const call: OutlineCall = (method, body) => outlineApi(key, method, body, instance);
    // The weekly report's own parent: kept when not given, cleared when empty.
    const weeklyParent = b.weeklyParentDocumentId === undefined ? (current?.weekly_parent_doc_id ?? null)
      : b.weeklyParentDocumentId ? docId(b.weeklyParentDocumentId) : null;
    // Someone else's key only writes where its owner chose: pointing it at other documents takes one's own key.
    // Checked before asking Outline, which would otherwise tell what that key can reach.
    if (!typed && current && current.created_by !== me(req)) {
      const moved = (id: string | null, storedId: string | null, storedUrl: string | null) =>
        id !== null && id !== storedId && !storedUrl?.endsWith(`/doc/${id}`);
      if (moved(parent, current.parent_doc_id, current.parent_doc_url)
        || moved(weeklyParent, current.weekly_parent_doc_id, current.weekly_parent_doc_url)) {
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
    const timeReport = Boolean(pipeTypeById(p.kind)?.timeReport);
    await query(
      `INSERT INTO pipe_outline_exports (pipe_id, outline_url, api_key, parent_doc_id, parent_doc_title, parent_doc_url, outline_user,
         daily, sprints, locale, created_by, weekly, weekly_parent_doc_id, weekly_parent_doc_title, weekly_parent_doc_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (pipe_id) DO UPDATE SET outline_url = $2, api_key = $3, parent_doc_id = $4, parent_doc_title = $5, parent_doc_url = $6,
         outline_user = $7, daily = $8, sprints = $9, locale = $10, created_by = $11, weekly = $12, weekly_parent_doc_id = $13,
         weekly_parent_doc_title = $14, weekly_parent_doc_url = $15, updated_at = now(),
         key_refused = false, last_error = NULL, last_error_at = NULL`,
      [
        p.id, instance, encrypt(key), doc.id, doc.title.slice(0, 500), absoluteOutlineUrl(doc.url, instance), who.user?.name?.slice(0, 200) ?? null,
        "daily" in b ? b.daily === true : Boolean(current?.daily),
        "sprints" in b ? b.sprints === true : Boolean(current?.sprints),
        // Who is told when the key is refused: the person who gave it.
        localeOf(req), typed ? me(req) : (current?.created_by ?? me(req)),
        timeReport && ("weekly" in b ? b.weekly === true : Boolean(current?.weekly)),
        weeklyDoc?.id ?? null, weeklyDoc?.title.slice(0, 500) ?? null, weeklyDoc ? absoluteOutlineUrl(weeklyDoc.url, instance) : null,
      ]
    );
    return present((await settingsOf(p.id))!, me(req));
  });

  app.delete("/pipes/:id/outline-export", async (req: Req) => {
    const p = await managedPipe(req);
    await query(`DELETE FROM pipe_outline_exports WHERE pipe_id = $1`, [p.id]);
    return { ok: true };
  });
}
