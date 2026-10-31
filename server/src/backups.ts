/**
 * Backups of the instance. They are made on the server, outside the app, by scripts/backup.sh (by hand, or on the
 * schedule an administrator chose with `backup.sh --setup`), by the updater before a one-click update, and by
 * scripts/restore.sh before a restore; each records what it did in `backup_runs`, and the plan in `backup_plan`.
 * The app only reads them: Administration › Backups shows them, and the administrators are told (once) when a backup
 * fails, when its off-site copy fails, or when the planned backups stopped coming.
 */
import type { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { one, query, type Row } from "./db.js";
import { tr, type Locale } from "./i18n.js";
import { escape, mailLayout, sendHtmlMail, type MailTheme } from "./mail.js";
import { pushTo } from "./push.js";
import { admins } from "./updates.js";

export type Schedule = "none" | "daily" | "weekly";
export type BackupProblem = "failed" | "remote-failed" | "stale" | null;

export interface BackupPlan {
  schedule: Schedule;
  at: string | null;
  keep: number | null;
  encrypted: boolean;
  remote: string | null;
  remoteKeep: number | null;
  updatedAt: string;
}

export interface BackupRun {
  id: string;
  kind: string;
  origin: string | null;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  file: string | null;
  size: number | null;
  encrypted: boolean;
  appVersion: string | null;
  host: string | null;
  remote: string | null;
  remoteOk: boolean | null;
  error: string | null;
}

/** How long a planned backup may be late before the administrators are told (a missed run, plus some slack). */
export const STALE_AFTER_MS: Record<Exclude<Schedule, "none">, number> = {
  daily: 50 * 3_600_000,
  weekly: 8 * 24 * 3_600_000,
};

const SCHEDULES = new Set(["none", "daily", "weekly"]);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));

function planOf(r: Row | null): BackupPlan | null {
  if (!r) return null;
  return {
    schedule: SCHEDULES.has(r.schedule) ? r.schedule : "none",
    at: r.at ?? null,
    keep: r.keep ?? null,
    encrypted: Boolean(r.encrypted),
    remote: r.remote ?? null,
    remoteKeep: r.remote_keep ?? null,
    updatedAt: iso(r.updated_at)!,
  };
}

function runOf(r: Row): BackupRun {
  return {
    id: r.id,
    kind: r.kind,
    origin: r.origin ?? null,
    startedAt: iso(r.started_at)!,
    finishedAt: iso(r.finished_at)!,
    ok: Boolean(r.ok),
    file: r.file ?? null,
    size: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
    encrypted: Boolean(r.encrypted),
    appVersion: r.app_version ?? null,
    host: r.host ?? null,
    remote: r.remote ?? null,
    remoteOk: r.remote_ok ?? null,
    error: r.error ?? null,
  };
}

/**
 * What is wrong, if anything: the last backup failed, or its off-site copy did; or planned backups are late (none
 * since the plan was made, or the last good one is too old).
 */
export function backupProblem(plan: BackupPlan | null, last: BackupRun | null, lastOk: BackupRun | null, now = Date.now()): BackupProblem {
  if (last && !last.ok) return "failed";
  if (last && last.ok && last.remote && last.remoteOk === false) return "remote-failed";
  if (plan && plan.schedule !== "none") {
    const since = new Date(lastOk?.finishedAt ?? plan.updatedAt).getTime();
    if (now - since > STALE_AFTER_MS[plan.schedule]) return "stale";
  }
  return null;
}

export async function backupStatus(now = Date.now()) {
  const plan = planOf(await one(`SELECT * FROM backup_plan WHERE id`));
  const { rows } = await query(`SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 30`);
  const runs = rows.map(runOf);
  // A restore makes no backup: it is listed, but the state is that of the backups.
  const last = runs.find((r) => r.kind !== "restore") ?? null;
  const lastOkRow = await one(`SELECT * FROM backup_runs WHERE kind <> 'restore' AND ok ORDER BY started_at DESC LIMIT 1`);
  const lastOk = lastOkRow ? runOf(lastOkRow) : null;
  return { plan, last, lastOk, runs, problem: backupProblem(plan, last, lastOk, now) };
}

export function backupEmail(lang: Locale, problem: Exclude<BackupProblem, null>, detail: { error?: string | null; since?: string | null }, theme: MailTheme = null) {
  const subject =
    problem === "failed" ? tr(lang, "A backup of TasksPipes failed")
    : problem === "remote-failed" ? tr(lang, "The off-site copy of a TasksPipes backup failed")
    : tr(lang, "TasksPipes has not been backed up as planned");
  const intro =
    problem === "stale"
      ? detail.since
        ? tr(lang, "The last backup was made on {date}.", { date: new Date(detail.since).toLocaleString(lang, { timeZone: config.timezone }) })
        : tr(lang, "No backup has been made since they were planned.")
      : tr(lang, "Check what happened, then make a backup again.");
  const lines = [
    detail.error ? `<p style="margin:0 0 12px"><code>${escape(detail.error.slice(0, 500))}</code></p>` : "",
    `<p style="margin:0">${escape(tr(lang, "See Administration › Backups, and the backup log on the server."))}</p>`,
  ];
  return {
    subject,
    html: mailLayout(lang, {
      title: subject,
      intro,
      body: lines.join(""),
      action: { label: tr(lang, "See the backups"), url: `${config.appUrl}/admin?tab=backups` },
      footer: escape(tr(lang, "You receive this e-mail because you administer this TasksPipes instance.")),
      theme,
    }),
  };
}

type Send = (lang: Locale, to: string, subject: string, html: string) => Promise<unknown>;

async function tell(problem: Exclude<BackupProblem, null>, detail: { error?: string | null; since?: string | null }, send: Send) {
  for (const a of await admins()) {
    const lang = (a.locale as Locale) ?? config.defaultLocale;
    const mail = backupEmail(lang, problem, detail, a.theme ?? null);
    await send(lang, a.email, mail.subject, mail.html).catch(() => {});
    await pushTo(a.id, { title: mail.subject, body: tr(lang, "See the backups"), url: "/admin?tab=backups", tag: "backup" }).catch(() => 0);
  }
}

/**
 * Tells the administrators of a problem with the backups, once each: a failed run (or its failed off-site copy) once,
 * late backups once until a good one comes. Safe with several instances of the app (each notice is claimed once).
 * Returns what was told.
 */
export async function checkBackups(send: Send = sendHtmlMail, now = Date.now()): Promise<BackupProblem> {
  const { plan, last, lastOk, problem } = await backupStatus(now);
  if ((problem === "failed" || problem === "remote-failed") && last) {
    const claimed = await one(`UPDATE backup_runs SET notified_at = now() WHERE id = $1 AND notified_at IS NULL RETURNING id`, [last.id]);
    if (!claimed) return null;
    await tell(problem, { error: last.error }, send);
    return problem;
  }
  if (problem === "stale" && plan) {
    // Once per late spell: a good backup made after the last notice starts a new one.
    const claimed = await one(
      `UPDATE backup_plan SET stale_notified_at = now()
       WHERE id AND (stale_notified_at IS NULL OR stale_notified_at < coalesce($1::timestamptz, updated_at)) RETURNING id`,
      [lastOk?.finishedAt ?? null]
    );
    if (!claimed) return null;
    await tell("stale", { since: lastOk?.finishedAt ?? null }, send);
    return "stale";
  }
  return null;
}

/** Registered by adminRoutes: administrators only. */
export async function backupRoutes(app: FastifyInstance) {
  app.get("/admin/backups", async () => backupStatus());
}
