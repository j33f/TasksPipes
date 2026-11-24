/**
 * Burndowns of pipes in sprints, read from the tasks' history: each task's state at a given time — whether it
 * existed, its pipe, sprint, points and status — is found by undoing, from its current state, the changes made since.
 * Every change of sprint and points is written in the history (details.sprint, details.points), and every entry keeps
 * the pipe and status before it.
 *
 * - A sprint's burndown: at the start, then at the end of each of its working days, the points of its tasks still to
 *   do (remaining), and of all its tasks (scope: it grows when tasks are added during the sprint), beside the ideal
 *   line from the points at the start down to zero.
 * - A pipe's burndown: at the end of each sprint, the points of the pipe's tasks still to do and done, then a
 *   projection of the end from the velocity.
 */
import { config } from "./config.js";
import { query, type Queryable, type Row } from "./db.js";
import { addDays, zonedInstant } from "./time.js";
import { isoWeekday } from "./sprints.js";

export interface TaskNow {
  id: string;
  createdAt: Date;
  pipeId: string | null;
  sprintId: string | null;
  points: number | null;
  status: string;
  assignee: string | null;
  taskType: string;
}

export interface HistoryEntry {
  taskId: string;
  at: Date;
  fromStatus: string | null;
  fromPipeId: string | null;
  details: { sprint?: { from: { id: string } | null }; points?: { from: number | null } } | null;
}

export type TaskState = Omit<TaskNow, "createdAt" | "assignee" | "taskType">;

/** A task's state at `at`, or null if it did not exist yet. `history` holds its entries, any order. */
export function stateAt(task: TaskNow, history: HistoryEntry[], at: Date): TaskState | null {
  if (task.createdAt > at) return null;
  const s: TaskState = { id: task.id, pipeId: task.pipeId, sprintId: task.sprintId, points: task.points, status: task.status };
  for (const e of [...history].sort((a, b) => b.at.getTime() - a.at.getTime())) {
    if (e.at <= at) break;
    // The state before the entry: what it changed goes back.
    if (e.fromStatus !== null) {
      s.status = e.fromStatus;
      s.pipeId = e.fromPipeId;
    }
    if (e.details?.sprint) s.sprintId = e.details.sprint.from?.id ?? null;
    if (e.details?.points) s.points = e.details.points.from ?? null;
  }
  return s;
}

const OPEN = (s: string) => s !== "done" && s !== "abandoned";

export interface BurndownPoint {
  /** The day whose end it is; null for the start. */
  day: string | null;
  ideal: number;
  /** Points still to do; null for days to come. */
  remaining: number | null;
  /** Points of all its tasks (dropped ones left out); null for days to come. */
  scope: number | null;
}

/** Its working days, from its first to its last. */
export function sprintDays(startsOn: string, endsOn: string, workDays: number[]) {
  const out: string[] = [];
  for (let d = startsOn; d <= endsOn && out.length < 400; d = addDays(d, 1)) if (workDays.includes(isoWeekday(d))) out.push(d);
  return out;
}

/** A sprint's burndown, from its tasks (now) and their history, up to `now`. */
export function sprintBurndown(
  sprint: { id: string; startsOn: string; endsOn: string },
  workDays: number[],
  tasks: TaskNow[],
  history: HistoryEntry[],
  now: Date,
  tz = config.timezone
): BurndownPoint[] {
  const byTask = new Map<string, HistoryEntry[]>();
  for (const e of history) byTask.set(e.taskId, [...(byTask.get(e.taskId) ?? []), e]);
  const measure = (at: Date) => {
    let remaining = 0;
    let scope = 0;
    for (const t of tasks) {
      const s = stateAt(t, byTask.get(t.id) ?? [], at);
      if (!s || s.sprintId !== sprint.id || s.status === "abandoned") continue;
      scope += s.points ?? 0;
      if (OPEN(s.status)) remaining += s.points ?? 0;
    }
    return { remaining, scope };
  };
  const days = sprintDays(sprint.startsOn, sprint.endsOn, workDays);
  const startAt = zonedInstant(sprint.startsOn, 0, tz);
  const start = measure(startAt <= now ? startAt : now);
  const n = days.length || 1;
  const ideal = (i: number) => Math.round(start.scope * (1 - i / n) * 10) / 10;
  const points: BurndownPoint[] = [{ day: null, ideal: ideal(0), ...start }];
  days.forEach((day, i) => {
    const end = zonedInstant(addDays(day, 1), 0, tz);
    // The day under way counts as it is now; days to come are left empty.
    const past = zonedInstant(day, 0, tz) <= now;
    const m = past ? measure(end < now ? end : now) : null;
    points.push({ day, ideal: ideal(i + 1), remaining: m?.remaining ?? null, scope: m?.scope ?? null });
  });
  return points;
}

export interface PipeProgressRow {
  sprintId: string;
  name: string;
  endsOn: string;
  /** Points of the pipe's tasks done, and still to do, when the sprint ended (now for the one under way). */
  done: number;
  remaining: number;
}

/** The pipe's points done and to do at the end of each sprint (in order), from its tasks and their history. */
export function pipeBurndown(pipeId: string, sprints: { id: string; name: string; endsOn: string; endAt: Date }[], tasks: TaskNow[], history: HistoryEntry[]) {
  const byTask = new Map<string, HistoryEntry[]>();
  for (const e of history) byTask.set(e.taskId, [...(byTask.get(e.taskId) ?? []), e]);
  return sprints.map((sp): PipeProgressRow => {
    let done = 0;
    let remaining = 0;
    for (const t of tasks) {
      const s = stateAt(t, byTask.get(t.id) ?? [], sp.endAt);
      if (!s || s.pipeId !== pipeId) continue;
      if (s.status === "done") done += s.points ?? 0;
      else if (OPEN(s.status)) remaining += s.points ?? 0;
    }
    return { sprintId: sp.id, name: sp.name, endsOn: sp.endsOn, done, remaining };
  });
}

// ---------------------------------------------------------------------------
// Reading tasks and their history

const taskNow = (r: Row): TaskNow => ({
  id: r.id, createdAt: new Date(r.created_at), pipeId: r.pipe_id, sprintId: r.sprint_id, points: r.points ?? null, status: r.status,
  assignee: r.assignee_name ?? null, taskType: r.task_type,
});

async function load(where: string, params: unknown[], db?: Queryable) {
  const { rows } = await query(
    `SELECT t.id, t.created_at, t.pipe_id, t.sprint_id, t.points, t.status, t.task_type, COALESCE(su.name, au.name) AS assignee_name
     FROM tasks t JOIN spaces s ON s.id = t.space_id LEFT JOIN users su ON su.id = s.user_id LEFT JOIN users au ON au.id = t.assignee_id
     WHERE ${where}`, params, db
  );
  const tasks = rows.map(taskNow);
  const ids = tasks.map((t) => t.id);
  const { rows: events } = ids.length
    ? await query(
      `SELECT task_id, created_at, from_status, from_pipe_id, details FROM task_events
       WHERE task_id = ANY($1::uuid[]) AND (from_status IS NOT NULL OR details ? 'sprint' OR details ? 'points')`, [ids], db)
    : { rows: [] };
  const history: HistoryEntry[] = events.map((e) => ({
    taskId: e.task_id, at: new Date(e.created_at), fromStatus: e.from_status, fromPipeId: e.from_pipe_id, details: e.details,
  }));
  return { tasks, history };
}

/** The tasks that are, or once were, in the sprint, with their history. */
export const sprintTasks = (sprintId: string, db?: Queryable) =>
  load(
    `t.sprint_id = $1 OR EXISTS (SELECT 1 FROM task_events e WHERE e.task_id = t.id
       AND (e.details->'sprint'->'from'->>'id' = $1::text OR e.details->'sprint'->'to'->>'id' = $1::text))`,
    [sprintId], db
  );

/** The tasks that are, or once were, in the pipe, with their history. */
export const pipeTasks = (pipeId: string, db?: Queryable) =>
  load(`t.pipe_id = $1 OR EXISTS (SELECT 1 FROM task_events e WHERE e.task_id = t.id AND (e.from_pipe_id = $1 OR e.to_pipe_id = $1))`, [pipeId], db);
