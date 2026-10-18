/**
 * One's own data: an export (zip of a JSON file and the tasks' files), and, for e-mail accounts, the deletion of the
 * account, confirmed by a two-factor code or a link sent by e-mail. What the account did in shared places stays in
 * the history, under a placeholder account of its own ("Deleted account"); its personal space goes with it.
 */
import crypto from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { one, pool, query, tx, type Queryable, type Row } from "./db.js";
import { bad } from "./errors.js";
import { getTaskRow, taskPermissions } from "./access.js";
import { TASK_KEY_PREFIX } from "./git.js";
import { localeOf, tr, type Locale } from "./i18n.js";
import { decrypt, hash } from "./auth.js";
import { verifyTotp } from "./totp.js";
import { mailEnabled, sendLinkMail } from "./mail.js";
import { closeUserConnections } from "./realtime.js";
import { LIMITS, rateLimited } from "./rate-limit.js";
import { ZipWriter } from "./zip.js";

export const DELETE_LINK_MINUTES = 30;
const SESSION_COOKIE = "tp_session";

/** Seam for the tests, which have no SMTP: how the confirmation link is sent. */
export const deletionMail = { enabled: () => mailEnabled(), send: sendLinkMail };

// ---------------------------------------------------------------------------
// Export

/** What the export holds, in its data.json: only tasks one may still see, and one's own comments. */
export async function exportData(userId: string, present: (t: Record<string, unknown>) => unknown, events: (id: string) => Promise<unknown>) {
  const profile = await one(
    `SELECT id, name, email, auth_kind, outline_url, locale, theme, notification_prefs, created_at, last_login_at
     FROM users WHERE id = $1`,
    [userId]
  );
  const teams = await query(
    `SELECT s.name, m.role, m.created_at FROM space_members m JOIN spaces s ON s.id = m.space_id
     WHERE m.user_id = $1 AND s.kind = 'team' ORDER BY lower(s.name)`,
    [userId]
  );
  // Tasks one wrote, sent or owns (holder of a personal space, or assignee).
  const candidates = await query(
    `SELECT t.id FROM tasks t JOIN spaces s ON s.id = t.space_id
     WHERE t.author_id = $1 OR t.sender_id = $1 OR COALESCE(t.assignee_id, s.user_id) = $1 ORDER BY t.number`,
    [userId]
  );
  const tasks: { row: Record<string, unknown>; key: string }[] = [];
  for (const { id } of candidates.rows) {
    const t = await getTaskRow(id);
    if (t && (await taskPermissions(t, userId)).view) tasks.push({ row: t, key: `${TASK_KEY_PREFIX}-${t.number}` });
  }
  const visible = new Map(tasks.map((t) => [t.row.id as string, t]));
  const comments = await query(
    `SELECT task_id, created_at, comment FROM task_events WHERE actor_id = $1 AND comment IS NOT NULL ORDER BY created_at`,
    [userId]
  );
  const time = await query(`SELECT task_id, spent_on, minutes, note, created_at FROM task_time_entries WHERE user_id = $1 ORDER BY spent_on`, [userId]);
  const files = tasks.length
    ? (await query(`SELECT id, task_id, name, mime, size, created_at FROM task_files WHERE task_id = ANY($1) ORDER BY created_at`, [[...visible.keys()]])).rows
    : [];
  const fileName = (f: Row) => `files/${visible.get(f.task_id)!.key}/${f.id}-${f.name}`;

  const data = {
    exportedAt: new Date().toISOString(),
    profile: {
      id: profile!.id, name: profile!.name, email: profile!.email, kind: profile!.auth_kind,
      outlineServer: profile!.auth_kind === "outline" ? (profile!.outline_url ?? config.outlineUrl) : null,
      locale: profile!.locale, theme: profile!.theme, notificationPrefs: profile!.notification_prefs,
      createdAt: profile!.created_at, lastSignInAt: profile!.last_login_at,
    },
    teams: teams.rows.map((m) => ({ name: m.name, role: m.role, since: m.created_at })),
    tasks: await Promise.all(tasks.map(async ({ row, key }) => ({
      key,
      ...(present(row) as object),
      history: await events(row.id as string),
      files: files.filter((f) => f.task_id === row.id).map((f) => ({ name: f.name, type: f.mime, size: f.size, addedAt: f.created_at, path: fileName(f) })),
    }))),
    // Every comment one wrote; the task is named only when one may still see it.
    comments: comments.rows.map((c) => {
      const t = visible.get(c.task_id);
      return { at: c.created_at, text: c.comment, task: t ? { key: t.key, title: t.row.title } : null };
    }),
    // Time one logged, the same way.
    timeLogged: time.rows.map((e) => {
      const t = visible.get(e.task_id);
      return { day: e.spent_on, minutes: e.minutes, note: e.note, at: e.created_at, task: t ? { key: t.key, title: t.row.title } : null };
    }),
  };
  return { data, files: files.map((f) => ({ id: f.id as string, path: fileName(f), at: f.created_at as Date })) };
}

/** The archive, as a stream: data.json, then each file, read from the database one at a time. */
function exportStream(data: unknown, files: { id: string; path: string; at: Date }[]) {
  const zip = new ZipWriter();
  return Readable.from((async function* () {
    yield* zip.file("data.json", JSON.stringify(data, null, 2));
    for (const f of files) {
      const r = await one(`SELECT content FROM task_files WHERE id = $1`, [f.id]);
      if (r) yield* zip.file(f.path, r.content, new Date(f.at));
    }
    yield* zip.end();
  })());
}

// ---------------------------------------------------------------------------
// Deletion

/**
 * Deletes an account. In one transaction:
 * - teams it alone administers get their oldest other member as admin; teams it is alone in go, with their tasks;
 * - its personal space goes, with its pipes and tasks (those others sent there too);
 * - every other reference (author, history, files, sender…) moves to a new placeholder account, owners are cleared;
 * - the account itself is deleted, and with it its sessions, links, memberships, invitations, picture, notifications.
 * Signing in again later makes a new, empty account: nothing links it back to the history.
 */
export async function deleteAccount(userId: string, db: Queryable = pool) {
  await db.query(
    `UPDATE space_members m SET role = 'admin' FROM (
       SELECT DISTINCT ON (o.space_id) o.space_id, o.user_id FROM space_members o
       JOIN space_members mine ON mine.space_id = o.space_id AND mine.user_id = $1 AND mine.role = 'admin'
       WHERE o.user_id <> $1
         AND NOT EXISTS (SELECT 1 FROM space_members a WHERE a.space_id = o.space_id AND a.role = 'admin' AND a.user_id <> $1)
       ORDER BY o.space_id, o.created_at, o.user_id) x
     WHERE m.space_id = x.space_id AND m.user_id = x.user_id`,
    [userId]
  );
  const { rows: gone } = await db.query(
    `SELECT id FROM spaces WHERE user_id = $1
     UNION SELECT s.id FROM spaces s JOIN space_members m ON m.space_id = s.id AND m.user_id = $1
       WHERE s.kind = 'team' AND NOT EXISTS (SELECT 1 FROM space_members o WHERE o.space_id = s.id AND o.user_id <> $1)`,
    [userId]
  );
  const spaces = gone.map((r) => r.id);
  await db.query(`DELETE FROM tasks WHERE space_id = ANY($1)`, [spaces]);
  await db.query(`DELETE FROM spaces WHERE id = ANY($1)`, [spaces]);

  const placeholder = (await db.query(
    `INSERT INTO users (id, name, auth_kind, disabled_at, deleted_at) VALUES (gen_uuidv7(), $1, 'deleted', now(), now()) RETURNING id`,
    [tr(config.defaultLocale, "Deleted account")]
  )).rows[0].id as string;
  // Owners are cleared rather than handed to the placeholder.
  await db.query(`UPDATE tasks SET assignee_id = NULL WHERE assignee_id = $1`, [userId]);
  // Every reference to the account that its deletion would not clear (no cascade, no SET NULL) moves to the placeholder.
  const { rows: refs } = await db.query(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
     FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND cardinality(c.conkey) = 1 AND c.confdeltype IN ('a', 'r')`
  );
  for (const r of refs) {
    const { rows } = await db.query(`SELECT format('UPDATE %s SET %I = $2 WHERE %I = $1', $1::text, $2::text, $2::text) AS sql`, [r.tbl, r.col]);
    await db.query(rows[0].sql, [userId, placeholder]);
  }
  // Ids kept without a foreign key: owners in the history, people named in fields and in history details.
  await db.query(`UPDATE task_events SET from_assignee_id = $2 WHERE from_assignee_id = $1`, [userId, placeholder]);
  await db.query(`UPDATE task_events SET to_assignee_id = $2 WHERE to_assignee_id = $1`, [userId, placeholder]);
  await db.query(`UPDATE tasks SET fields = replace(fields::text, $1, $2)::jsonb WHERE fields::text LIKE '%' || $1 || '%'`, [userId, placeholder]);
  await db.query(`UPDATE task_events SET details = replace(details::text, $1, $2)::jsonb WHERE details::text LIKE '%' || $1 || '%'`, [userId, placeholder]);
  await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

async function confirmDeletion(userId: string) {
  await tx((client) => deleteAccount(userId, client));
  closeUserConnections(userId);
}

const requireEmailAccount = (req: FastifyRequest) => {
  if (req.user!.kind !== "email") throw bad("An Outline account cannot be deleted here: it comes from your Outline workspace.");
};

/** Routes of the signed-in person (mounted with the API, under /api). */
export async function accountRoutes(app: FastifyInstance, opts: { present: (t: Record<string, unknown>) => unknown; events: (id: string, lang: Locale) => Promise<unknown> }) {
  app.get("/me/export", rateLimited(LIMITS.dataExport), async (req, reply) => {
    const lang = localeOf(req);
    const { data, files } = await exportData(req.user!.id, opts.present, (id) => opts.events(id, lang));
    req.log.info({ userId: req.user!.id, files: files.length }, "Data exported");
    reply.header("content-type", "application/zip");
    reply.header("content-disposition", `attachment; filename="taskspipes-export-${new Date().toISOString().slice(0, 10)}.zip"`);
    reply.header("cache-control", "no-store");
    return reply.send(exportStream(data, files));
  });

  // First step: how the deletion will be confirmed (two-factor code, or a link sent by e-mail).
  app.post("/me/delete/request", rateLimited(LIMITS.accountDeletion), async (req) => {
    requireEmailAccount(req);
    const u = await one(`SELECT name, email, locale, totp_secret FROM users WHERE id = $1`, [req.user!.id]);
    if (u!.totp_secret) return { method: "totp" };
    if (!deletionMail.enabled() || !u!.email) throw bad("Deleting an account needs e-mail or two-factor authentication on this instance.");
    const token = crypto.randomBytes(32).toString("base64url");
    await query(`DELETE FROM login_tokens WHERE user_id = $1 AND purpose = 'delete' AND used_at IS NULL`, [req.user!.id]);
    await query(`INSERT INTO login_tokens (id, user_id, purpose, expires_at) VALUES ($1, $2, 'delete', $3)`, [
      hash(token), req.user!.id, new Date(Date.now() + DELETE_LINK_MINUTES * 60_000),
    ]);
    const lang: Locale = u!.locale ?? localeOf(req);
    await deletionMail.send(lang, u!.email, tr(lang, "Confirm the deletion of your TasksPipes account"), [
      tr(lang, "Hello {name},", { name: u!.name }),
      tr(lang, "You asked to delete your TasksPipes account. This link deletes it for good, with your personal space and its tasks; what you did in teams stays in their history, under “Deleted account”. It is valid for {minutes} minutes.", { minutes: DELETE_LINK_MINUTES }),
      tr(lang, "If you did not ask for it, ignore this e-mail: your account stays as it is."),
    ], { label: tr(lang, "Delete my account"), url: `${config.appUrl}/account/delete?token=${token}` });
    return { method: "email" };
  });

  // With two-factor authentication: the code confirms it.
  app.post<{ Body: { code?: string } }>("/me/delete", rateLimited(LIMITS.accountDeletion), async (req, reply) => {
    requireEmailAccount(req);
    const u = await one(`SELECT totp_secret, totp_last_step FROM users WHERE id = $1`, [req.user!.id]);
    const secret = decrypt(u?.totp_secret);
    if (!secret) throw bad("Wrong code");
    if (verifyTotp(secret, String(req.body?.code || ""), u!.totp_last_step === null ? null : Number(u!.totp_last_step)) === null) {
      throw bad("Wrong code");
    }
    await confirmDeletion(req.user!.id);
    req.log.info({ userId: req.user!.id }, "Account deleted");
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}

/** The link of the e-mail: valid once, for its account only, whether or not that browser is signed in. */
export async function deletionLinkRoutes(app: FastifyInstance) {
  app.post<{ Body: { token?: string } }>("/api/auth/delete-account", rateLimited(LIMITS.magic), async (req, reply) => {
    const token = String(req.body?.token || "");
    const row = token && (await one(
      `UPDATE login_tokens l SET used_at = now() FROM users u
       WHERE l.id = $1 AND l.purpose = 'delete' AND l.used_at IS NULL AND l.expires_at > now()
         AND u.id = l.user_id AND u.auth_kind = 'email'
       RETURNING l.user_id`,
      [hash(token)]
    ));
    if (!row) throw bad("This link is invalid or has expired.");
    await confirmDeletion(row.user_id);
    req.log.info({ userId: row.user_id }, "Account deleted");
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}
