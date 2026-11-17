/**
 * In-app notifications (the bell): what happened on tasks one is concerned by, kept until marked as read.
 * The same reasons as the e-mails (notifications.ts), for everyone, plus the news of one's teams: a task created
 * by someone else in a pipe of a team one is in. Written with the history entry that causes them (same
 * transaction); the person's open pages are told once it is committed. Access is checked again when listed:
 * someone who can no longer see a task does not see what happened on it.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterCommit, one, query, type Queryable, type Row } from "./db.js";
import { taskVisibleSql, teamOnlyKinds } from "./access.js";
import { notifyUser } from "./realtime.js";
import { bad } from "./errors.js";

export const INBOX_KINDS = ["received", "assigned", "refused", "comment", "mention", "unblocked", "created"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** At most this many notifications are listed (the most recent unread ones). */
export const INBOX_LIMIT = 100;
/** Comments are quoted up to this length. */
const EXCERPT = 200;

/** Accounts that get in-app notifications: real people, signed in at least once, not disabled. `u` is the users table. */
const ELIGIBLE = `u.auth_kind <> 'system' AND u.disabled_at IS NULL AND u.last_login_at IS NOT NULL`;

/** Writes the in-app notifications of a history entry (one per person) and tells their pages once committed. */
export async function addToInbox(db: Queryable, eventId: number, to: { userId: string; taskId: string; kind: InboxKind }[]) {
  if (!to.length) return;
  const { rows } = await db.query(
    `INSERT INTO inbox (user_id, task_id, kind, event_id)
     SELECT u.id, x.task_id, x.kind, $4 FROM unnest($1::uuid[], $2::uuid[], $3::text[]) AS x(user_id, task_id, kind)
     JOIN users u ON u.id = x.user_id WHERE ${ELIGIBLE}
     ON CONFLICT (user_id, event_id) DO NOTHING RETURNING user_id`,
    [to.map((x) => x.userId), to.map((x) => x.taskId), to.map((x) => x.kind), eventId]
  );
  const told = [...new Set(rows.map((r) => r.user_id as string))];
  afterCommit(db, () => {
    for (const id of told) notifyUser(id, { type: "inbox" });
  });
}

/** Team members to tell of a task created in a pipe of their team by someone else (`e`: the history entry). */
export async function newsOf(db: Queryable, e: Row): Promise<string[]> {
  if (e.type !== "created" || !e.to_pipe_id) return [];
  const { rows } = await db.query(
    `SELECT m.user_id FROM space_members m JOIN spaces s ON s.id = m.space_id
     WHERE m.space_id = $1 AND s.kind = 'team' AND m.user_id <> $2`,
    [e.to_space_id, e.actor_id]
  );
  return rows.map((r) => r.user_id as string);
}

const ITEM_SELECT = `
  SELECT i.id, i.kind, i.created_at, i.read_at, e.comment,
         a.id AS actor_id, a.name AS actor_name, a.avatar_url AS actor_avatar,
         t.id AS task_id, t.number, t.title, t.pipe_id, p.name AS pipe_name, t.space_id,
         COALESCE(su.name, s.name) AS space_name, s.kind AS space_kind
  FROM inbox i
  JOIN tasks t ON t.id = i.task_id
  JOIN spaces s ON s.id = t.space_id
  LEFT JOIN users su ON su.id = s.user_id
  LEFT JOIN pipes p ON p.id = t.pipe_id
  LEFT JOIN task_events e ON e.id = i.event_id
  LEFT JOIN users a ON a.id = e.actor_id`;

const present = (r: Row) => ({
  id: Number(r.id),
  kind: r.kind as InboxKind,
  createdAt: r.created_at,
  actor: r.actor_id ? { id: r.actor_id, name: r.actor_name, avatarUrl: r.actor_avatar } : null,
  excerpt: r.comment && ["comment", "mention", "received", "refused"].includes(r.kind)
    ? (r.comment.length > EXCERPT ? `${r.comment.slice(0, EXCERPT)}…` : r.comment)
    : null,
  task: {
    id: r.task_id,
    number: r.number,
    title: r.title,
    pipe: r.pipe_id ? { id: r.pipe_id, name: r.pipe_name } : null,
    space: { id: r.space_id, name: r.space_name, kind: r.space_kind },
  },
});

const VISIBLE = `${taskVisibleSql("$1", "$2")}`;

/** Unread notifications someone may still see, newest first, and how many there are. */
export async function unreadOf(userId: string) {
  const { rows } = await query(
    `${ITEM_SELECT} WHERE i.user_id = $1 AND i.read_at IS NULL AND ${VISIBLE} ORDER BY i.id DESC LIMIT ${INBOX_LIMIT}`,
    [userId, teamOnlyKinds()]
  );
  return { items: rows.map(present), unread: await unreadCount(userId) };
}

export async function unreadCount(userId: string): Promise<number> {
  const r = await one(
    `SELECT count(*)::int AS n FROM inbox i JOIN tasks t ON t.id = i.task_id LEFT JOIN pipes p ON p.id = t.pipe_id
     WHERE i.user_id = $1 AND i.read_at IS NULL AND ${VISIBLE}`,
    [userId, teamOnlyKinds()]
  );
  return r?.n ?? 0;
}

/** Ids of notifications sent by the app: a list of positive integers, or none (all of them). */
function cleanIds(v: unknown): number[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length > 500 || !v.every((x) => Number.isSafeInteger(x) && x > 0)) throw bad("Invalid notifications");
  return v as number[];
}

/** Forgets notifications read more than 30 days ago, and unread ones older than 90 days. */
export async function cleanupInbox() {
  await query(`DELETE FROM inbox WHERE read_at < now() - interval '30 days' OR created_at < now() - interval '90 days'`);
}

export async function inboxRoutes(app: FastifyInstance) {
  const me = (req: FastifyRequest) => req.user!.id;

  app.get("/inbox", async (req) => unreadOf(me(req)));

  app.get("/inbox/count", async (req) => ({ unread: await unreadCount(me(req)) }));

  // Marks some notifications (ids) or all of them as read; the person's other pages follow.
  app.post("/inbox/read", async (req) => {
    const uid = me(req);
    const ids = cleanIds((req.body as { ids?: unknown } | null)?.ids);
    await query(
      `UPDATE inbox SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2))`,
      [uid, ids]
    );
    notifyUser(uid, { type: "inbox" });
    return { unread: await unreadCount(uid) };
  });
}
