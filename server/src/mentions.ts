/**
 * @mentions in comments and descriptions, written `@[Name](mention:<user id>)`. Only people who can open the task are
 * offered and notified: at once in the app, and by e-mail (notifications.ts) when they are not online then.
 */
import { one, query, type Queryable } from "./db.js";
import { taskVisibleSql, teamOnlyKinds } from "./access.js";
import { notifyUser } from "./realtime.js";

const MENTION = /@\[([^\]\n]{1,100})\]\(mention:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

/** The people a text mentions, each once. */
export function mentionedIds(text: string | null | undefined): string[] {
  return [...new Set([...String(text ?? "").matchAll(MENTION)].map((m) => m[2].toLowerCase()))];
}

/** Those mentioned in `after` but not in `before` (a description changed: only newcomers are told). */
export const newMentions = (before: string | null | undefined, after: string | null | undefined) => {
  const old = new Set(mentionedIds(before));
  return mentionedIds(after).filter((id) => !old.has(id));
};

/** People who may be told of a task: active accounts, signed in once, who can open it. `u` is users, `t` the task. */
const REACHABLE = (teamOnly: string) => `u.disabled_at IS NULL AND u.auth_kind IN ('outline', 'email')
  AND (u.auth_kind <> 'outline' OR u.last_login_at IS NOT NULL)
  AND ${taskVisibleSql("u.id", teamOnly)}`;

/** Whom someone may mention on a task: people they see, who can open it; by name, at most 10. */
export async function mentionable(taskId: string, userId: string, q: string) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.avatar_url, s.id AS space_id
     FROM tasks t LEFT JOIN pipes p ON p.id = t.pipe_id
     JOIN users u ON user_visible($2, u.id) AND u.id <> $2
     LEFT JOIN spaces s ON s.user_id = u.id
     WHERE t.id = $1 AND ${REACHABLE("$4")} AND ($3 = '' OR lower(u.name) LIKE '%' || lower($3) || '%')
     ORDER BY lower(u.name) LIMIT 10`,
    [taskId, userId, q.trim().slice(0, 100).replace(/[%_\\]/g, ""), teamOnlyKinds()]
  );
  return rows.map((u) => ({ id: u.id, name: u.name, avatarUrl: u.avatar_url, spaceId: u.space_id }));
}

/**
 * The people a history entry mentions (in its comment, or newly in the description: `details.mentioned`) who can open
 * the task, the author left out. They are told at once in the app; returned for the e-mail notifications.
 */
export async function mentionRecipients(db: Queryable, eventId: number): Promise<string[]> {
  const e = await one(`SELECT task_id, actor_id, comment, details FROM task_events WHERE id = $1`, [eventId], db);
  if (!e) return [];
  const ids = [...new Set([...mentionedIds(e.comment), ...((e.details?.mentioned as string[] | undefined) ?? [])])].filter((id) => id !== e.actor_id);
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT u.id FROM tasks t LEFT JOIN pipes p ON p.id = t.pipe_id JOIN users u ON u.id = ANY($2::uuid[])
     WHERE t.id = $1 AND ${REACHABLE("$3")}`,
    [e.task_id, ids, teamOnlyKinds()]
  );
  const task = await one(`SELECT id, number, title FROM tasks WHERE id = $1`, [e.task_id], db);
  const actor = await one(`SELECT name FROM users WHERE id = $1`, [e.actor_id], db);
  for (const r of rows) notifyUser(r.id, { type: "mention", task: { id: task!.id, number: task!.number, title: task!.title }, by: actor?.name });
  return rows.map((r) => r.id as string);
}
