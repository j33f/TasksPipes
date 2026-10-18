/**
 * E-mail notifications: a task received in one's incoming (or a team's), a task one now owns, a task one sent
 * refused, a comment on a task one wrote or owns, and a morning reminder of due dates.
 *
 * Notifications are written with the history entry that causes them (same transaction), then e-mailed by
 * runNotifications(), called every minute: at once (grouped per task, see GROUP_DELAY_MS and TASK_GAP_MS), in a
 * daily digest at REPORT_HOUR, or not at all, as each person chooses per kind. Access is checked again when
 * sending: someone who can no longer see a task gets nothing about it. Confidential and team-only tasks are
 * only named by their key: their content stays in the app.
 */
import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { one, query, type Queryable, type Row } from "./db.js";
import { getTaskRow, isConfidential, taskPermissions } from "./access.js";
import { bad } from "./errors.js";
import { localeOf, localize, tr, type Locale } from "./i18n.js";
import { mailEnabled, sendHtmlMail } from "./mail.js";
import { stageLabel } from "./pipeTypes.js";
import { TASK_KEY_PREFIX } from "./git.js";
import { dailyPeriod, addDays, localDay, zonedInstant } from "./time.js";
import { rateLimited, type Limit } from "./rate-limit.js";

export const KINDS = ["received", "assigned", "refused", "comment", "due"] as const;
export type Kind = (typeof KINDS)[number];
export type Mode = "immediate" | "digest" | "off";
export type Prefs = Record<Kind, Mode> & { dueHour: number };

export const DEFAULT_PREFS: Prefs = {
  received: "immediate",
  assigned: "immediate",
  refused: "immediate",
  comment: "digest",
  // Due dates have their own e-mail, in the morning: "immediate" means that reminder.
  due: "immediate",
  dueHour: 8,
};

/** An immediate e-mail waits this long after the first notification, to gather the actions that follow. */
export const GROUP_DELAY_MS = 2 * 60_000;
/** At most one immediate e-mail per task and person in this time. */
export const TASK_GAP_MS = 15 * 60_000;

/** Whether notifications are on: with e-mail set up (tests turn them on without SMTP). */
export const notificationState = { enabled: mailEnabled };

const MODES: Mode[] = ["immediate", "digest", "off"];

/** Someone's choices, completed with the defaults. */
export function prefsOf(raw: unknown): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const p: Prefs = { ...DEFAULT_PREFS };
  for (const k of KINDS) if (MODES.includes(r[k] as Mode) && (k !== "due" || r[k] !== "digest")) p[k] = r[k] as Mode;
  if (Number.isInteger(r.dueHour) && (r.dueHour as number) >= 0 && (r.dueHour as number) <= 23) p.dueHour = r.dueHour as number;
  return p;
}

/** Checks a change of preferences sent by the app. */
export function cleanPrefs(body: unknown): Partial<Prefs> {
  if (!body || typeof body !== "object") throw bad("Invalid notification settings");
  const out: Partial<Prefs> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "dueHour") {
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 23) throw bad("Invalid notification settings");
      out.dueHour = v as number;
    } else if ((KINDS as readonly string[]).includes(k) && MODES.includes(v as Mode) && !(k === "due" && v === "digest")) {
      out[k as Kind] = v as Mode;
    } else {
      throw bad("Invalid notification settings");
    }
  }
  return out;
}

export async function savePrefs(userId: string, change: Partial<Prefs>): Promise<Prefs> {
  const r = await one(
    `UPDATE users SET notification_prefs = notification_prefs || $2::jsonb WHERE id = $1 RETURNING notification_prefs`,
    [userId, JSON.stringify(change)]
  );
  return prefsOf(r?.notification_prefs);
}

/**
 * Accounts that may get e-mails: with an address, not a system account, signed in at least once (an invitation not
 * taken up, or an Outline colleague who never came, gets nothing); never disabled accounts. `u` is the users table.
 */
const ELIGIBLE = `u.email IS NOT NULL AND u.auth_kind <> 'system' AND u.disabled_at IS NULL AND u.last_login_at IS NOT NULL`;

type RowKind = "received" | "assigned" | "refused" | "comment" | "overdue";
const prefKind = (k: RowKind): Kind => (k === "overdue" ? "due" : k);

// ---------------------------------------------------------------------------
// Queueing, with the history entry

/** Writes the notifications caused by a history entry (call it in the transaction that wrote it). */
export async function queueNotifications(db: Queryable, eventId: number) {
  if (!notificationState.enabled) return;
  const e = await one(
    `SELECT e.*, t.author_id, COALESCE(s.user_id, t.assignee_id) AS owner_id
     FROM task_events e JOIN tasks t ON t.id = e.task_id JOIN spaces s ON s.id = t.space_id WHERE e.id = $1`,
    [eventId],
    db
  );
  if (!e) return;
  // One notification per person and entry; the first reason found wins.
  const to = new Map<string, RowKind>();
  const add = (userId: string | null, kind: RowKind) => userId && !to.has(userId) && to.set(userId, kind);
  if (e.type === "sent" || e.type === "refused") {
    const { rows } = await query(`SELECT user_id FROM space_members WHERE space_id = $1`, [e.to_space_id], db);
    for (const r of rows) add(r.user_id, e.type === "sent" ? "received" : "refused");
  }
  if (e.to_assignee_id && e.to_assignee_id !== e.from_assignee_id) add(e.to_assignee_id, "assigned");
  // A comment, on its own or written with another change; a refusal's reason is in its own notification.
  if (e.comment && e.type !== "refused") {
    add(e.author_id, "comment");
    add(e.owner_id, "comment");
  }
  to.delete(e.actor_id);
  if (!to.size) return;
  await db.query(
    `INSERT INTO notifications (user_id, task_id, kind, event_id)
     SELECT u.id, $3, x.kind, $4 FROM unnest($1::uuid[], $2::text[]) AS x(user_id, kind) JOIN users u ON u.id = x.user_id
     WHERE ${ELIGIBLE}`,
    [[...to.keys()], [...to.values()], e.task_id, eventId]
  );
}

// ---------------------------------------------------------------------------
// E-mails

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface NotificationLine {
  kind: Exclude<RowKind, "overdue">;
  type: string | null;
  comment: string | null;
  actorName: string | null;
  toSpaceName: string | null;
  toPersonal: boolean;
}

/** What happened, in a sentence; without user text (comment, reason) when the task is confidential. */
export function describe(lang: Locale, l: NotificationLine, masked: boolean): string {
  const name = l.actorName ?? tr(lang, "Someone");
  const excerpt = l.comment && !masked ? (l.comment.length > 400 ? `${l.comment.slice(0, 400)}…` : l.comment) : "";
  const quote = (s: string) => (excerpt ? (lang === "fr" ? `${s}\u00a0: « ${excerpt} »` : `${s}: “${excerpt}”`) : s);
  switch (l.kind) {
    case "received":
      return quote(l.toPersonal
        ? tr(lang, "{name} sent you this task", { name })
        : tr(lang, "{name} sent this task to the incoming of {space}", { name, space: l.toSpaceName ?? "" }));
    case "assigned":
      return tr(lang, "{name} made you the owner of this task", { name });
    case "refused":
      return quote(tr(lang, "{name} refused this task", { name }));
    case "comment":
      return quote(tr(lang, "{name} commented", { name }));
  }
}

const taskKey = (t: Row) => `${TASK_KEY_PREFIX}-${t.number}`;
const taskName = (t: Row, masked: boolean) => (masked ? taskKey(t) : `${taskKey(t)} ${t.title}`);
const taskUrl = (t: Row) => `${config.appUrl}/?task=${t.id}`;

/** Where the task is: "Team › Pipe › Column", or "Incoming of Team". */
function taskPath(lang: Locale, t: Row): string {
  if (!t.pipe_id) return tr(lang, "Incoming of {space}", { space: t.space_name });
  const stage = stageLabel(t.pipe_kind, t.stage);
  return [t.space_name, t.pipe_name, stage ? localize(lang, stage) : null].filter(Boolean).join(" › ");
}

function taskBlock(lang: Locale, t: Row, lines: string[]): string {
  const masked = isConfidential(t);
  const title = masked
    ? `${escape(taskKey(t))} <span style="color:#66778F">· ${escape(tr(lang, "confidential task: open it to see its content"))}</span>`
    : `${escape(taskKey(t))} ${escape(t.title)}`;
  return `<div style="margin:16px 0;padding:12px 14px;border:1px solid #e5e7eb;border-radius:8px">`
    + `<div style="font-weight:600"><a href="${taskUrl(t)}" style="color:#0366d6;text-decoration:none">${title}</a></div>`
    + (masked ? "" : `<div style="color:#66778F;font-size:13px">${escape(taskPath(lang, t))}</div>`)
    + `<ul style="padding-left:18px;margin:8px 0 0">${lines.map((l) => `<li>${escape(l)}</li>`).join("")}</ul></div>`;
}

function page(lang: Locale, title: string, body: string, unsubscribe: string) {
  return `<div lang="${lang}" style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#111319;max-width:640px">`
    + `<h2 style="font-size:18px;margin:0 0 4px">${escape(title)}</h2>${body}`
    + `<p style="color:#66778F;font-size:12px;margin-top:24px">${escape(tr(lang, "You receive this e-mail because of your notification settings in TasksPipes."))} `
    + `<a href="${config.appUrl}/" style="color:#66778F">${escape(tr(lang, "Change them"))}</a> · `
    + `<a href="${escape(unsubscribe)}" style="color:#66778F">${escape(tr(lang, "Unsubscribe"))}</a></p></div>`;
}

const SUBJECTS: Record<NotificationLine["kind"], string> = {
  received: "New task for you: {task}",
  assigned: "You now own {task}",
  refused: "Task refused: {task}",
  comment: "New comment on {task}",
};

export function immediateEmail(lang: Locale, t: Row, lines: NotificationLine[], unsubscribe: string) {
  const masked = isConfidential(t);
  const kinds = new Set(lines.map((l) => l.kind));
  const task = taskName(t, masked);
  const subject = kinds.size === 1 ? tr(lang, SUBJECTS[lines[0].kind], { task }) : tr(lang, "Activity on {task}", { task });
  return { subject, html: page(lang, subject, taskBlock(lang, t, lines.map((l) => describe(lang, l, masked))), unsubscribe) };
}

export function digestEmail(lang: Locale, day: string, tasks: { t: Row; lines: NotificationLine[] }[], unsubscribe: string) {
  const subject = tr(lang, "Your TasksPipes notifications — {day}", { day });
  const body = tasks.map(({ t, lines }) => taskBlock(lang, t, lines.map((l) => describe(lang, l, isConfidential(t))))).join("");
  return { subject, html: page(lang, subject, body, unsubscribe) };
}

const MAX_DUE_LINES = 30;

export function dueEmail(lang: Locale, day: string, sections: { overdue: Row[]; today: Row[]; tomorrow: Row[] }, unsubscribe: string) {
  const subject = tr(lang, "Your due dates — {day}", { day });
  const list = (title: string, tasks: Row[]) => {
    if (!tasks.length) return "";
    const items = tasks.slice(0, MAX_DUE_LINES).map((t) => {
      const masked = isConfidential(t);
      const where = masked ? "" : ` <span style="color:#66778F">· ${escape(taskPath(lang, t))}</span>`;
      const due = title === "Overdue" ? ` <span style="color:#66778F">· ${escape(tr(lang, "due on {date}", { date: t.due_date }))}</span>` : "";
      return `<li><a href="${taskUrl(t)}" style="color:#0366d6;text-decoration:none">${escape(taskName(t, masked))}</a>${where}${due}</li>`;
    });
    if (tasks.length > MAX_DUE_LINES) items.push(`<li>${escape(tr(lang, "and {n} more", { n: tasks.length - MAX_DUE_LINES }))}</li>`);
    return `<h3 style="font-size:15px;margin:18px 0 6px">${escape(tr(lang, title))} (${tasks.length})</h3><ul style="padding-left:18px;margin:0">${items.join("")}</ul>`;
  };
  const body = list("Overdue", sections.overdue) + list("Due today", sections.today) + list("Due tomorrow", sections.tomorrow);
  return { subject, html: page(lang, subject, body, unsubscribe) };
}

// ---------------------------------------------------------------------------
// Unsubscribing: a signed link (no state kept), shown as a page with a button, and one-click (RFC 8058)

const unsubscribeKey = Buffer.from(crypto.hkdfSync("sha256", config.appSecret, "", "taskspipes:unsubscribe", 32));
const sign = (userId: string, kinds: string) => crypto.createHmac("sha256", unsubscribeKey).update(`${userId}:${kinds}`).digest("base64url");

export function unsubscribeUrl(userId: string, kinds: Kind[]): string {
  const k = [...new Set(kinds)].sort().join(",");
  return `${config.appUrl}/notifications/unsubscribe?u=${userId}&k=${k}&s=${sign(userId, k)}`;
}

/** The person and kinds of a signed link, or null. */
export function verifyUnsubscribe(u: unknown, k: unknown, s: unknown): { userId: string; kinds: Kind[] } | null {
  if (typeof u !== "string" || typeof k !== "string" || typeof s !== "string") return null;
  const kinds = k.split(",");
  if (!kinds.length || !kinds.every((x) => (KINDS as readonly string[]).includes(x))) return null;
  const expected = Buffer.from(sign(u, k));
  const given = Buffer.from(s);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return { userId: u, kinds: kinds as Kind[] };
}

export const UNSUBSCRIBE_LIMIT: Limit = { name: "unsubscribe", max: 20, timeWindow: 60_000 };

const KIND_LABELS: Record<Kind, string> = {
  received: "Tasks received",
  assigned: "Tasks you now own",
  refused: "Tasks refused",
  comment: "Comments",
  due: "Due date reminders",
};

function unsubscribePage(lang: Locale, title: string, text: string, button?: { action: string; label: string }) {
  const form = button
    ? `<form method="post" action="${escape(button.action)}"><button style="font:inherit;background:#0366d6;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-weight:600;cursor:pointer">${escape(button.label)}</button></form>`
    : `<p><a href="${config.appUrl}/" style="color:#0366d6">${escape(tr(lang, "Open TasksPipes"))}</a></p>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta name="robots" content="noindex"><title>${escape(title)} — TasksPipes</title></head>`
    + `<body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111319;max-width:520px;margin:48px auto;padding:0 16px">`
    + `<h1 style="font-size:20px">${escape(title)}</h1><p>${escape(text)}</p>${form}</body></html>`;
}

export async function notificationRoutes(app: FastifyInstance) {
  // One-click unsubscribing posts a form (RFC 8058); this parser only applies to these routes.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => done(null, body));

  type Link = { Querystring: Record<string, string> };
  const handle = (apply: boolean) => async (req: FastifyRequest<Link>, reply: FastifyReply) => {
    const q = req.query;
    const link = verifyUnsubscribe(q.u, q.k, q.s);
    const user = link && (await one(`SELECT locale FROM users WHERE id = $1`, [link.userId]).catch(() => null));
    const lang: Locale = (user?.locale as Locale) || localeOf(req);
    reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    if (!link) {
      return reply.code(400).send(unsubscribePage(lang, tr(lang, "Invalid link"), tr(lang, "This unsubscribe link is not valid. You can change your e-mail notifications in the settings of TasksPipes.")));
    }
    const what = link.kinds.map((k) => tr(lang, KIND_LABELS[k])).join(", ");
    if (!apply) {
      return unsubscribePage(lang, tr(lang, "Unsubscribe"), tr(lang, "Stop the e-mails about: {what}?", { what }), {
        action: req.url, label: tr(lang, "Unsubscribe"),
      });
    }
    // A link of an account that no longer exists gets the same answer.
    if (user) await savePrefs(link.userId, Object.fromEntries(link.kinds.map((k) => [k, "off"])));
    return unsubscribePage(lang, tr(lang, "Unsubscribed"), tr(lang, "You will no longer get e-mails about: {what}. You can turn them back on in the settings of TasksPipes.", { what }));
  };
  const limited = rateLimited(UNSUBSCRIBE_LIMIT);
  app.get<Link>("/notifications/unsubscribe", limited, handle(false));
  app.post<Link>("/notifications/unsubscribe", limited, handle(true));
}

// ---------------------------------------------------------------------------
// Sending

export interface Mail {
  lang: Locale;
  to: string;
  subject: string;
  html: string;
  headers: Record<string, string>;
}
export type Send = (m: Mail) => Promise<unknown>;
const defaultSend: Send = (m) => sendHtmlMail(m.lang, m.to, m.subject, m.html, m.headers);

const unsubscribeHeaders = (url: string) => ({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });

const LINE_SELECT = `
  SELECT n.id, n.user_id, n.task_id, n.kind, n.created_at, n.due_date, e.type, e.comment, a.name AS actor_name,
         COALESCE(tsu.name, ts.name) AS to_space_name, ts.user_id = n.user_id AS to_personal
  FROM notifications n
  LEFT JOIN task_events e ON e.id = n.event_id
  LEFT JOIN users a ON a.id = e.actor_id
  LEFT JOIN spaces ts ON ts.id = e.to_space_id
  LEFT JOIN users tsu ON tsu.id = ts.user_id`;

const toLine = (r: Row): NotificationLine => ({
  kind: r.kind, type: r.type, comment: r.comment, actorName: r.actor_name, toSpaceName: r.to_space_name, toPersonal: Boolean(r.to_personal),
});

/** Marks notifications as gone out (or dropped); returns those this run took, so that none goes twice. */
async function settle(ids: number[], channel: string, dropped = false): Promise<number[]> {
  if (!ids.length) return [];
  const { rows } = await query(
    `UPDATE notifications SET ${dropped ? "dropped_at" : "sent_at"} = now(), channel = $2
     WHERE id = ANY($1) AND sent_at IS NULL AND dropped_at IS NULL RETURNING id`,
    [ids, channel]
  );
  return rows.map((r) => Number(r.id));
}

/** The task as `userId` may see it, or null if they no longer can. */
async function visibleTask(taskId: string, userId: string): Promise<Row | null> {
  const t = await getTaskRow(taskId);
  return t && (await taskPermissions(t, userId)).view ? t : null;
}

interface Recipient {
  id: string;
  email: string;
  lang: Locale;
  prefs: Prefs;
}

async function recipientsOf(ids: string[]): Promise<Map<string, Recipient>> {
  const { rows } = await query(`SELECT u.id, u.email, u.locale, u.notification_prefs FROM users u WHERE u.id = ANY($1) AND ${ELIGIBLE}`, [ids]);
  return new Map(rows.map((r) => [r.id, { id: r.id, email: r.email, lang: (r.locale as Locale) ?? config.defaultLocale, prefs: prefsOf(r.notification_prefs) }]));
}

async function deliver(send: Send, r: Recipient, mail: { subject: string; html: string }, unsubscribe: string) {
  await send({ lang: r.lang, to: r.email, subject: mail.subject, html: mail.html, headers: unsubscribeHeaders(unsubscribe) });
}

/** Pending notifications (not due-date ones), per person and task. */
async function pending(): Promise<{ users: Map<string, Recipient>; groups: Map<string, Row[]> }> {
  const { rows } = await query(`${LINE_SELECT} WHERE n.sent_at IS NULL AND n.dropped_at IS NULL AND n.kind <> 'overdue' ORDER BY n.id`);
  const users = await recipientsOf([...new Set(rows.map((r) => r.user_id as string))]);
  const groups = new Map<string, Row[]>();
  const gone: number[] = [];
  for (const r of rows) {
    const u = users.get(r.user_id);
    // No longer reachable by e-mail, or turned off since: dropped.
    if (!u || u.prefs[prefKind(r.kind)] === "off") gone.push(Number(r.id));
    else groups.set(`${r.user_id}:${r.task_id}`, [...(groups.get(`${r.user_id}:${r.task_id}`) ?? []), r]);
  }
  await settle(gone, "off", true);
  return { users, groups };
}

/** Immediate e-mails whose grouping delay is over. */
async function sendImmediate(now: Date, send: Send): Promise<number> {
  const { users, groups } = await pending();
  let sent = 0;
  for (const rows of groups.values()) {
    const u = users.get(rows[0].user_id)!;
    const ready = rows.filter((r) => u.prefs[prefKind(r.kind)] === "immediate");
    if (!ready.length || now.getTime() - new Date(ready[0].created_at).getTime() < GROUP_DELAY_MS) continue;
    const last = await one(
      `SELECT max(sent_at) AS at FROM notifications WHERE user_id = $1 AND task_id = $2 AND channel = 'immediate'`,
      [u.id, ready[0].task_id]
    );
    if (last?.at && now.getTime() - new Date(last.at).getTime() < TASK_GAP_MS) continue;
    const t = await visibleTask(ready[0].task_id, u.id);
    if (!t) {
      await settle(rows.map((r) => Number(r.id)), "no_access", true);
      continue;
    }
    const taken = new Set(await settle(ready.map((r) => Number(r.id)), "immediate"));
    const lines = ready.filter((r) => taken.has(Number(r.id))).map(toLine);
    if (!lines.length) continue;
    const unsubscribe = unsubscribeUrl(u.id, lines.map((l) => prefKind(l.kind)));
    await deliver(send, u, immediateEmail(u.lang, t, lines, unsubscribe), unsubscribe).then(() => sent++, () => {});
  }
  return sent;
}

/** The daily digest of everyone's "digest" notifications. */
async function sendDigests(day: string, send: Send): Promise<number> {
  const { users, groups } = await pending();
  const perUser = new Map<string, { t: Row; rows: Row[] }[]>();
  for (const rows of groups.values()) {
    const u = users.get(rows[0].user_id)!;
    const due = rows.filter((r) => u.prefs[prefKind(r.kind)] === "digest");
    if (!due.length) continue;
    const t = await visibleTask(due[0].task_id, u.id);
    if (!t) {
      await settle(rows.map((r) => Number(r.id)), "no_access", true);
      continue;
    }
    perUser.set(u.id, [...(perUser.get(u.id) ?? []), { t, rows: due }]);
  }
  let sent = 0;
  for (const [userId, tasks] of perUser) {
    const u = users.get(userId)!;
    const taken = new Set(await settle(tasks.flatMap((x) => x.rows.map((r) => Number(r.id))), "digest"));
    const kept = tasks
      .map(({ t, rows }) => ({ t, lines: rows.filter((r) => taken.has(Number(r.id))).map(toLine) }))
      .filter((x) => x.lines.length);
    if (!kept.length) continue;
    const unsubscribe = unsubscribeUrl(u.id, kept.flatMap((x) => x.lines.map((l) => prefKind(l.kind))));
    await deliver(send, u, digestEmail(u.lang, day, kept, unsubscribe), unsubscribe).then(() => sent++, () => {});
  }
  return sent;
}

/** Morning reminders of due dates: once a day per person, at their hour (in TIMEZONE). */
async function sendDueReminders(now: Date, send: Send): Promise<number> {
  const today = localDay(now, config.timezone);
  const { rows } = await query(
    `SELECT u.id FROM users u
     WHERE ${ELIGIBLE} AND (u.due_reminded_on IS NULL OR u.due_reminded_on < $1)
       AND COALESCE(u.notification_prefs->>'due', 'immediate') <> 'off'`,
    [today]
  );
  const users = await recipientsOf(rows.map((r) => r.id));
  let sent = 0;
  for (const u of users.values()) {
    if (u.prefs.due === "off" || now < zonedInstant(today, u.prefs.dueHour, config.timezone)) continue;
    const claimed = await one(
      `UPDATE users SET due_reminded_on = $2 WHERE id = $1 AND (due_reminded_on IS NULL OR due_reminded_on < $2) RETURNING id`,
      [u.id, today]
    );
    if (!claimed) continue;
    // Open tasks they own (their personal space, or assigned in a team), outside archived pipes.
    const { rows: tasks } = await query(
      `SELECT t.id, t.due_date FROM tasks t JOIN spaces s ON s.id = t.space_id LEFT JOIN pipes p ON p.id = t.pipe_id
       WHERE (s.user_id = $1 OR (s.kind = 'team' AND t.assignee_id = $1))
         AND t.status NOT IN ('done', 'abandoned') AND t.due_date IS NOT NULL AND t.due_date <= $2
         AND p.archived_at IS NULL
       ORDER BY t.due_date, t.number`,
      [u.id, addDays(today, 1)]
    );
    const sections = { overdue: [] as Row[], today: [] as Row[], tomorrow: [] as Row[] };
    for (const x of tasks) {
      const t = await visibleTask(x.id, u.id);
      if (!t) continue;
      if (t.due_date < today) {
        // Overdue tasks are told once per due date.
        const fresh = await one(
          `INSERT INTO notifications (user_id, task_id, kind, due_date, channel, sent_at) VALUES ($1, $2, 'overdue', $3, 'due', now())
           ON CONFLICT (user_id, task_id, due_date) WHERE kind = 'overdue' DO NOTHING RETURNING id`,
          [u.id, t.id, t.due_date]
        );
        if (fresh) sections.overdue.push(t);
      } else (t.due_date === today ? sections.today : sections.tomorrow).push(t);
    }
    if (!sections.overdue.length && !sections.today.length && !sections.tomorrow.length) continue;
    const unsubscribe = unsubscribeUrl(u.id, ["due"]);
    await deliver(send, u, dueEmail(u.lang, today, sections, unsubscribe), unsubscribe).then(() => sent++, () => {});
  }
  return sent;
}

/**
 * Sends what is due (call it every minute): immediate e-mails, the daily digest once REPORT_HOUR has passed
 * (once, even across restarts: report_runs), and the morning reminders. Returns how many e-mails went out.
 */
export async function runNotifications(now = new Date(), send: Send = defaultSend): Promise<number> {
  if (!notificationState.enabled) return 0;
  let sent = await sendImmediate(now, send);
  const day = localDay(now, config.timezone);
  const end = dailyPeriod(day, config.reportHour, config.timezone).end;
  if (now >= end) {
    const claimed = await one(
      `INSERT INTO report_runs (kind, period_end) VALUES ('notify-digest', $1) ON CONFLICT DO NOTHING RETURNING kind`,
      [end]
    );
    if (claimed) sent += await sendDigests(day, send);
  }
  sent += await sendDueReminders(now, send);
  return sent;
}

/** Forgets notifications gone out more than 30 days ago (overdue ones are kept while they apply). */
export async function cleanupNotifications() {
  await query(
    `DELETE FROM notifications n WHERE COALESCE(n.sent_at, n.dropped_at) < now() - interval '30 days'
       AND (n.kind <> 'overdue' OR NOT EXISTS (
         SELECT 1 FROM tasks t WHERE t.id = n.task_id AND t.due_date = n.due_date AND t.status NOT IN ('done', 'abandoned')))`
  );
}

