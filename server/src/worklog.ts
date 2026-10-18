/**
 * Estimates and time logged by hand, beside the time computed from the history (reports.ts). Those who edit a
 * task's fields set its estimate and log their own time on it, on a day up to MAX_DAYS_BACK ago; an entry is changed
 * or deleted by its author, and deleted by the admins of the task's team too. Whoever can see the task sees them.
 */
import { config } from "./config.js";
import { one, query, type Queryable, type Row } from "./db.js";
import { bad } from "./errors.js";
import { addDays, isDay, localDay } from "./time.js";

export const MAX_DAYS_BACK = 90;
/** An estimate: up to 1,000 hours, in minutes. */
export const MAX_ESTIMATE = 60_000;

/** Time logged on the task `t`, in minutes. */
export const LOGGED_MINUTES = `(SELECT COALESCE(sum(te.minutes), 0) FROM task_time_entries te WHERE te.task_id = t.id) AS logged_minutes`;

/** An estimate from a request: whole minutes, or null for none. */
export function cleanEstimate(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > MAX_ESTIMATE) throw bad("Invalid estimate");
  return v as number;
}

/** The minutes of an entry: 1 to a whole day. */
export function cleanMinutes(v: unknown): number {
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 1440) throw bad("Logged time is from 1 minute to 24 hours");
  return v as number;
}

/** The day of an entry: today (in TIMEZONE) by default, never later, at most MAX_DAYS_BACK days ago. */
export function cleanDay(v: unknown, now = new Date()): string {
  const today = localDay(now, config.timezone);
  if (v === undefined || v === null || v === "") return today;
  if (!isDay(v) || v > today || v < addDays(today, -MAX_DAYS_BACK)) throw bad("Log time for a day of the last {n} days", { n: MAX_DAYS_BACK });
  return v;
}

export const cleanNote = (v: unknown) => {
  const note = typeof v === "string" ? v.trim() : "";
  if (note.length > 500) throw bad("{label} is too long", { label: "Note" });
  return note;
};

/** The entries of a task, newest day first; `userId` sees which ones they may change or delete. */
export async function timeEntries(taskId: string, userId: string, canDeleteAll: boolean, db?: Queryable) {
  const { rows } = await query(
    `SELECT te.*, u.name, u.avatar_url FROM task_time_entries te JOIN users u ON u.id = te.user_id
     WHERE te.task_id = $1 ORDER BY te.spent_on DESC, te.created_at DESC`,
    [taskId],
    db
  );
  return {
    entries: rows.map((r) => presentEntry(r, userId, canDeleteAll)),
    totalMinutes: rows.reduce((n, r) => n + Number(r.minutes), 0),
  };
}

export const presentEntry = (r: Row, userId: string, canDeleteAll: boolean) => ({
  id: r.id,
  user: { id: r.user_id, name: r.name, avatarUrl: r.avatar_url },
  spentOn: r.spent_on,
  minutes: r.minutes,
  note: r.note,
  createdAt: r.created_at,
  mine: r.user_id === userId,
  canDelete: r.user_id === userId || canDeleteAll,
});

export const getEntry = (id: string, db?: Queryable) => one(`SELECT * FROM task_time_entries WHERE id = $1`, [id], db);

/**
 * Time logged on a pipe's tasks during a weekly report period: the days after its start, up to its end (local
 * days), per person and per task, with each task's estimate and all the time logged on it.
 */
export async function loggedInPeriod(pipeId: string, period: { start: Date; end: Date }) {
  const from = localDay(period.start, config.timezone);
  const to = localDay(period.end, config.timezone);
  const { rows } = await query(
    `SELECT te.task_id, te.minutes, u.name AS person, t.number, t.title, t.task_type, t.estimate_minutes,
            COALESCE(asg.name, su.name) AS owner,
            (SELECT sum(a.minutes) FROM task_time_entries a WHERE a.task_id = t.id) AS total
     FROM task_time_entries te JOIN tasks t ON t.id = te.task_id JOIN users u ON u.id = te.user_id
     JOIN spaces s ON s.id = t.space_id LEFT JOIN users su ON su.id = s.user_id LEFT JOIN users asg ON asg.id = t.assignee_id
     WHERE t.pipe_id = $1 AND te.spent_on > $2 AND te.spent_on <= $3`,
    [pipeId, from, to]
  );
  const people = new Map<string, number>();
  const tasks = new Map<string, { id: string; number: number; title: string; taskType: string; owner: string | null; minutes: number; estimateMinutes: number | null; totalMinutes: number }>();
  for (const r of rows) {
    people.set(r.person, (people.get(r.person) ?? 0) + r.minutes);
    const t = tasks.get(r.task_id) ?? {
      id: r.task_id, number: r.number, title: r.title, taskType: r.task_type, owner: r.owner, minutes: 0,
      estimateMinutes: r.estimate_minutes, totalMinutes: Number(r.total),
    };
    t.minutes += r.minutes;
    tasks.set(r.task_id, t);
  }
  return {
    totalMinutes: rows.reduce((n, r) => n + r.minutes, 0),
    byPerson: [...people].map(([name, minutes]) => ({ name, minutes })).sort((a, b) => b.minutes - a.minutes),
    tasks: [...tasks.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 20),
  };
}
