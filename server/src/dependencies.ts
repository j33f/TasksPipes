/**
 * Dependencies between tasks: a task is blocked while one of the tasks it waits for is not done (or abandoned).
 * Anyone may link two tasks they can open. A linked task someone cannot open is shown to them by its title and owner
 * only, without a way to open it; a confidential or team-only one not even by that. Once the last blocker is finished,
 * the owner and author of the waiting task are told, in the app at once, and by e-mail (notifications.ts).
 */
import { one, type Queryable, type Row } from "./db.js";
import { OPEN_BLOCKERS, isConfidential, taskVisibleSql, teamOnlyKinds } from "./access.js";
import { bad } from "./errors.js";
import { notifyUser } from "./realtime.js";
import { queueUnblocked } from "./notifications.js";

/** Statuses that release the tasks waiting for a task. */
export const RESOLVED = ["done", "abandoned"];
export const isResolved = (status: string | null | undefined) => RESOLVED.includes(String(status));
/** At most this many tasks blocking one task. */
export const MAX_BLOCKERS = 50;

export interface Dependency {
  /** Only for a task one can open, or a blocker (to unlink it). */
  id?: string;
  number?: number;
  title?: string;
  status?: string;
  owner?: { id?: string; name: string } | null;
  resolved: boolean;
  /** One can open it. */
  visible: boolean;
  /** Confidential or team-only, and out of reach: nothing of it is shown. */
  masked?: boolean;
}

/** A linked task, as someone sees it (see the module's comment). `keepId`: the id of a hidden one is given too. */
export function presentDependency(r: Row, keepId: boolean): Dependency {
  const resolved = isResolved(r.status);
  if (r.visible) {
    return {
      id: r.id, number: r.number, title: r.title, status: r.status, resolved, visible: true,
      owner: r.owner_id ? { id: r.owner_id, name: r.owner_name } : null,
    };
  }
  const id = keepId ? { id: r.id } : {};
  if (isConfidential(r)) return { ...id, resolved, visible: false, masked: true };
  return { ...id, title: r.title, owner: r.owner_id ? { name: r.owner_name } : null, resolved, visible: false };
}

const LINKED = (user: string, teamOnly: string) => `
  SELECT t.id, t.number, t.title, t.status, t.task_type, p.kind AS pipe_kind,
         COALESCE(s.user_id, t.assignee_id) AS owner_id, COALESCE(su.name, asg.name) AS owner_name,
         ${taskVisibleSql(user, teamOnly)} AS visible
  FROM task_dependencies d
  JOIN tasks t ON t.id = %SIDE%
  JOIN spaces s ON s.id = t.space_id
  LEFT JOIN users su ON su.id = s.user_id
  LEFT JOIN users asg ON asg.id = t.assignee_id
  LEFT JOIN pipes p ON p.id = t.pipe_id`;

/** The tasks `taskId` waits for, and those waiting for it, as `userId` sees them. */
export async function dependenciesOf(db: Queryable, taskId: string, userId: string) {
  const sql = LINKED("$2", "$3");
  const params = [taskId, userId, teamOnlyKinds()];
  const [blockedBy, blocks] = await Promise.all([
    db.query(`${sql.replace("%SIDE%", "d.blocker_id")} WHERE d.task_id = $1 ORDER BY d.created_at`, params),
    db.query(`${sql.replace("%SIDE%", "d.task_id")} WHERE d.blocker_id = $1 ORDER BY d.created_at`, params),
  ]);
  return {
    // The blockers of a task one may edit can be unlinked, even those one cannot open.
    blockedBy: blockedBy.rows.map((r) => presentDependency(r, true)),
    blocks: blocks.rows.map((r) => presentDependency(r, false)),
  };
}

/** Whether `blockerId` already waits, directly or not, for `taskId` (linking them would make a loop). */
export async function wouldLoop(db: Queryable, taskId: string, blockerId: string): Promise<boolean> {
  const r = await one(
    `WITH RECURSIVE up(id) AS (
       SELECT $2::uuid UNION SELECT d.blocker_id FROM task_dependencies d JOIN up ON d.task_id = up.id)
     SELECT 1 AS loop FROM up WHERE id = $1 LIMIT 1`,
    [taskId, blockerId],
    db
  );
  return Boolean(r);
}

/** Links `taskId` to the task it waits for (both checked by the caller); in a transaction. */
export async function addDependency(db: Queryable, taskId: string, blockerId: string, userId: string): Promise<boolean> {
  if (taskId === blockerId) throw bad("A task cannot wait for itself");
  // One link at a time, so that two at once cannot make a loop.
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('task_dependencies'))`);
  if (await wouldLoop(db, taskId, blockerId)) throw bad("This task already waits for this one");
  const n = await one(`SELECT count(*)::int AS n FROM task_dependencies WHERE task_id = $1`, [taskId], db);
  if (n!.n >= MAX_BLOCKERS) throw bad("A task waits for {n} tasks at most", { n: MAX_BLOCKERS });
  const { rowCount } = await db.query(
    `INSERT INTO task_dependencies (task_id, blocker_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [taskId, blockerId, userId]
  );
  return Boolean(rowCount);
}

/** Number of blockers of a task still to finish. */
export const openBlockers = async (db: Queryable, taskId: string): Promise<number> =>
  (await one(`SELECT ${OPEN_BLOCKERS.replace("t.id", "$1::uuid")}::int AS n`, [taskId], db))!.n;

/**
 * After the history entry `eventId` finished its task: the tasks that waited only for it are no longer blocked.
 * Their owner and author who can open them are told, the person who finished it left out. Returns who was told.
 */
export async function releaseWaiting(db: Queryable, eventId: number): Promise<{ userId: string; taskId: string }[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT u.id AS user_id, t.id AS task_id, t.number, t.title
     FROM task_events e
     JOIN task_dependencies d ON d.blocker_id = e.task_id
     JOIN tasks t ON t.id = d.task_id
     LEFT JOIN pipes p ON p.id = t.pipe_id
     JOIN spaces s ON s.id = t.space_id
     JOIN users u ON u.id IN (t.author_id, COALESCE(s.user_id, t.assignee_id))
     WHERE e.id = $1 AND t.status NOT IN ('done', 'abandoned') AND ${OPEN_BLOCKERS} = 0
       AND u.id <> e.actor_id AND u.disabled_at IS NULL AND u.auth_kind IN ('outline', 'email')
       AND (u.auth_kind <> 'outline' OR u.last_login_at IS NOT NULL)
       AND ${taskVisibleSql("u.id", "$2")}`,
    [eventId, teamOnlyKinds()]
  );
  if (!rows.length) return [];
  const told = rows.map((r) => ({ userId: r.user_id as string, taskId: r.task_id as string }));
  await queueUnblocked(db, eventId, told);
  for (const r of rows) notifyUser(r.user_id, { type: "unblocked", task: { id: r.task_id, number: r.number, title: r.title } });
  return told;
}
