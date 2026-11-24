/**
 * Sprints, for the pipes whose type works in sprints (PipeType.sprints). A sprint is planned, then started — one at a
 * time per pipe, the points of its tasks then committed — then closed: the points done are kept, its unfinished tasks
 * go to the next sprint or back to the backlog (tasks without a sprint), and a report is frozen. The members of the
 * pipe's space plan sprints and put tasks in them; whoever sees the pipe sees its sprints.
 *
 * Each change of a task's sprint is written in its history (details.sprint), as are its points and its moves: the
 * burndown and the velocity are read from there.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { one, query, tx, type Queryable, type Row } from "./db.js";
import { bad, forbidden, notFound } from "./errors.js";
import { pipeTypeById } from "./pipeTypes.js";
import { notifySpace } from "./realtime.js";
import { addDays, isDay } from "./time.js";

export type VelocityMode = "manual" | "learned";

export interface SprintSettings {
  /** Length of a sprint, in weeks. */
  weeks: number;
  /** Day a sprint starts, ISO (1 Monday … 7 Sunday). */
  startDay: number;
  /** Days worked, ISO: the burndown goes down on them only. */
  workDays: number[];
  /** Velocity used to plan: typed, or learned from the last sprints (once there are enough). */
  velocityMode: VelocityMode;
  /** Points per sprint expected while none is learned; none when null. */
  initialVelocity: number | null;
  /** The report of a closed sprint is e-mailed to the space's members. */
  sendReport: boolean;
}

export const DEFAULT_SPRINT_SETTINGS: SprintSettings = {
  weeks: 2, startDay: 1, workDays: [1, 2, 3, 4, 5], velocityMode: "learned", initialVelocity: null, sendReport: false,
};
export const MAX_WEEKS = 4;
export const MAX_VELOCITY = 10_000;
/** At most this many sprints are listed with a pipe. */
const MAX_LISTED = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const worksInSprints = (kind: string | null | undefined) => Boolean(kind && pipeTypeById(kind)?.sprints);

const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const days = (list: number[]) => [...new Set(list)].sort((a, b) => a - b);

/** Settings as stored (null or partial: the defaults fill them). */
export function sprintSettings(raw: unknown): SprintSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<SprintSettings>;
  const d = DEFAULT_SPRINT_SETTINGS;
  return {
    weeks: isInt(r.weeks, 1, MAX_WEEKS) ? r.weeks : d.weeks,
    startDay: isInt(r.startDay, 1, 7) ? r.startDay : d.startDay,
    workDays: Array.isArray(r.workDays) && r.workDays.length && r.workDays.every((x) => isInt(x, 1, 7)) ? days(r.workDays) : d.workDays,
    velocityMode: r.velocityMode === "manual" || r.velocityMode === "learned" ? r.velocityMode : d.velocityMode,
    initialVelocity: isInt(r.initialVelocity, 0, MAX_VELOCITY) ? r.initialVelocity : null,
    sendReport: r.sendReport === true,
  };
}

/** Settings from a request, over the current ones: each value given must be valid. */
export function cleanSprintSettings(v: unknown, current: SprintSettings): SprintSettings {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("Invalid sprint settings");
  const b = v as Record<string, unknown>;
  const next = { ...current };
  if ("weeks" in b) {
    if (!isInt(b.weeks, 1, MAX_WEEKS)) throw bad("A sprint lasts 1 to {n} weeks", { n: MAX_WEEKS });
    next.weeks = b.weeks;
  }
  if ("startDay" in b) {
    if (!isInt(b.startDay, 1, 7)) throw bad("Invalid sprint settings");
    next.startDay = b.startDay;
  }
  if ("workDays" in b) {
    const list = b.workDays;
    if (!Array.isArray(list) || !list.length || !list.every((x) => isInt(x, 1, 7))) throw bad("Choose at least one working day");
    next.workDays = days(list as number[]);
  }
  if ("velocityMode" in b) {
    if (b.velocityMode !== "manual" && b.velocityMode !== "learned") throw bad("Invalid sprint settings");
    next.velocityMode = b.velocityMode;
  }
  if ("initialVelocity" in b) {
    if (b.initialVelocity === null || b.initialVelocity === "") next.initialVelocity = null;
    else if (!isInt(b.initialVelocity, 0, MAX_VELOCITY)) throw bad("Invalid velocity");
    else next.initialVelocity = b.initialVelocity;
  }
  if ("sendReport" in b) next.sendReport = b.sendReport === true;
  return next;
}

// ---------------------------------------------------------------------------
// Days, as YYYY-MM-DD

/** ISO weekday: 1 Monday … 7 Sunday. */
export const isoWeekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
/** A date column (read as text, db.ts) as YYYY-MM-DD. */
const dayString = (v: unknown) => String(v).slice(0, 10);

export function cleanDay(v: unknown): string {
  // A real day: 2026-02-30 is refused.
  if (!isDay(v) || addDays(v, 0) !== v) throw bad("Invalid dates");
  return v;
}

/** Dates of a new sprint: right after the last one, or from the next start day (today if it is one). */
export function nextSprintDates(settings: SprintSettings, lastEnd: string | null, today: string) {
  let start = lastEnd ? addDays(lastEnd, 1) : today;
  if (!lastEnd) while (isoWeekday(start) !== settings.startDay) start = addDays(start, 1);
  return { startsOn: start, endsOn: addDays(start, settings.weeks * 7 - 1) };
}

// ---------------------------------------------------------------------------
// Sprints

export const presentSprint = (s: Row) => ({
  id: s.id,
  number: s.number,
  name: s.name,
  goal: s.goal,
  startsOn: dayString(s.starts_on),
  endsOn: dayString(s.ends_on),
  status: s.status as "planned" | "active" | "closed",
  committedPoints: s.committed_points ?? null,
  completedPoints: s.completed_points ?? null,
  exceptional: Boolean(s.exceptional),
  report: s.report ?? null,
  startedAt: s.started_at ?? null,
  closedAt: s.closed_at ?? null,
});

/** The sprints of a pipe, latest first. */
export async function pipeSprints(pipeId: string, db?: Queryable) {
  const { rows } = await query(`SELECT * FROM sprints WHERE pipe_id = $1 ORDER BY number DESC LIMIT ${MAX_LISTED}`, [pipeId], db);
  return rows.map(presentSprint);
}

/** The sprint a task of the pipe may be put in, from a request (null: none, the backlog). */
export async function cleanSprintId(v: unknown, pipeId: string | null, kind: string | null, db?: Queryable): Promise<Row | null> {
  if (v === null || v === undefined || v === "") return null;
  if (!pipeId || !worksInSprints(kind)) throw bad("This pipe does not work in sprints");
  if (typeof v !== "string" || !UUID.test(v)) throw bad("Sprint not found");
  const s = await one(`SELECT * FROM sprints WHERE id = $1 AND pipe_id = $2`, [v, pipeId], db);
  if (!s) throw bad("Sprint not found");
  if (s.status === "closed") throw bad("A closed sprint takes no more tasks");
  return s;
}

const ref = (s: Row | null | undefined) => (s ? { id: s.id as string, name: s.name as string } : null);
/** History details of a task moved from one sprint to another (null: the backlog). */
export const sprintChange = (from: Row | null | undefined, to: Row | null | undefined) => ({ sprint: { from: ref(from), to: ref(to) } });

/** What sprints.ts needs of the routes: the pipe one may reach, and the history of tasks. */
export interface SprintDeps {
  loadPipeFor: (id: unknown, userId: string) => Promise<{ p: Row; role: string | null }>;
  /** Writes a "fields" entry in a task's history with these details (without e-mails: closing a sprint moves many). */
  recordSprintChange: (db: Queryable, taskId: string, actorId: string, details: object) => Promise<void>;
  /** Today in the instance's time zone, as YYYY-MM-DD. */
  today: () => string;
}

type Req = FastifyRequest<{ Params: Record<string, string>; Body: Record<string, unknown> | undefined }>;

function text(v: unknown, label: string, max: number): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length > max) throw bad("{label} is too long", { label });
  return s;
}

export async function sprintRoutes(app: FastifyInstance, deps: SprintDeps) {
  const me = (req: FastifyRequest) => req.user!.id;

  /** The pipe, for planning its sprints: a member of its space, a pipe in sprints, not archived. */
  async function plannablePipe(pipeId: unknown, uid: string) {
    const { p, role } = await deps.loadPipeFor(pipeId, uid);
    if (!worksInSprints(p.kind)) throw bad("This pipe does not work in sprints");
    if (!role) throw forbidden("Only the space's members can plan sprints");
    if (p.archived_at) throw bad("This pipe is archived");
    return p;
  }

  async function loadSprint(id: string, uid: string) {
    const s = UUID.test(id) ? await one(`SELECT * FROM sprints WHERE id = $1`, [id]) : null;
    if (!s) throw notFound("Sprint not found");
    // Someone who cannot see the pipe gets the same answer as for no sprint.
    const p = await plannablePipe(s.pipe_id, uid).catch((err) => {
      throw err?.statusCode === 404 ? notFound("Sprint not found") : err;
    });
    return { s, p };
  }

  async function createSprint(db: Queryable | undefined, p: Row, uid: string, b: Record<string, unknown> = {}) {
    const settings = sprintSettings(p.sprint_settings);
    const last = await one(`SELECT max(number) AS n, max(ends_on) AS end FROM sprints WHERE pipe_id = $1`, [p.id], db);
    const number = Number(last?.n ?? 0) + 1;
    const dates = nextSprintDates(settings, last?.end ? dayString(last.end) : null, deps.today());
    const startsOn = b.startsOn === undefined ? dates.startsOn : cleanDay(b.startsOn);
    const endsOn = b.endsOn !== undefined ? cleanDay(b.endsOn) : b.startsOn === undefined ? dates.endsOn : addDays(startsOn, settings.weeks * 7 - 1);
    if (endsOn < startsOn) throw bad("A sprint ends after it starts");
    return (await one(
      `INSERT INTO sprints (pipe_id, number, name, goal, starts_on, ends_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [p.id, number, text(b.name, "Name", 120) || `Sprint ${number}`, text(b.goal, "Goal", 2000), startsOn, endsOn, uid], db
    ))!;
  }

  // The sprints of a pipe, for whoever sees it (a task's page offers them).
  app.get("/pipes/:id/sprints", async (req: Req) => {
    const { p } = await deps.loadPipeFor(req.params.id, me(req));
    return worksInSprints(p.kind) ? pipeSprints(p.id) : [];
  });

  // A new sprint, planned: after the last one by default.
  app.post("/pipes/:id/sprints", async (req: Req) => {
    const p = await plannablePipe(req.params.id, me(req));
    const s = await createSprint(undefined, p, me(req), req.body ?? {}).catch((err) => {
      // Two made at once: the second one would take the same number.
      throw err?.code === "23505" ? bad("Someone else just added a sprint: try again") : err;
    });
    notifySpace(p.space_id, { type: "task.updated" }, me(req));
    return presentSprint(s);
  });

  // Its name, goal, dates (not once closed) and whether it counts for the velocity.
  app.patch("/sprints/:id", async (req: Req) => {
    const { s, p } = await loadSprint(req.params.id, me(req));
    const b = req.body ?? {};
    if (s.status === "closed" && ("startsOn" in b || "endsOn" in b)) throw bad("The dates of a closed sprint cannot change");
    const startsOn = "startsOn" in b ? cleanDay(b.startsOn) : dayString(s.starts_on);
    const endsOn = "endsOn" in b ? cleanDay(b.endsOn) : dayString(s.ends_on);
    if (endsOn < startsOn) throw bad("A sprint ends after it starts");
    const row = await one(
      `UPDATE sprints SET name = $2, goal = $3, starts_on = $4, ends_on = $5, exceptional = $6 WHERE id = $1 RETURNING *`,
      [s.id, "name" in b ? text(b.name, "Name", 120) || s.name : s.name, "goal" in b ? text(b.goal, "Goal", 2000) : s.goal,
       startsOn, endsOn, "exceptional" in b ? b.exceptional === true : s.exceptional]
    );
    notifySpace(p.space_id, { type: "task.updated" }, me(req));
    return presentSprint(row!);
  });

  // Started: one sprint at a time; the points of its tasks (not dropped) are committed.
  app.post("/sprints/:id/start", async (req: Req) => {
    const { s, p } = await loadSprint(req.params.id, me(req));
    if (s.status !== "planned") throw bad("Only a planned sprint can start");
    const row = await tx(async (client) => {
      const active = await one(`SELECT name FROM sprints WHERE pipe_id = $1 AND status = 'active'`, [p.id], client);
      if (active) throw bad("“{name}” is under way: close it first", { name: active.name });
      const committed = await one(
        `SELECT COALESCE(sum(points), 0) AS n FROM tasks WHERE sprint_id = $1 AND status <> 'abandoned'`, [s.id], client
      );
      return one(
        `UPDATE sprints SET status = 'active', committed_points = $2, started_at = now(), started_by = $3 WHERE id = $1 RETURNING *`,
        [s.id, Number(committed!.n), me(req)], client
      );
    }).catch((err) => {
      throw err?.code === "23505" ? bad("Another sprint is under way: close it first") : err;
    });
    notifySpace(p.space_id, { type: "task.updated" }, me(req));
    return presentSprint(row!);
  });

  // Closed: its points done are kept, its unfinished tasks go to the next sprint (made if need be) or the backlog.
  app.post("/sprints/:id/close", async (req: Req) => {
    const uid = me(req);
    const { s, p } = await loadSprint(req.params.id, uid);
    if (s.status !== "active") throw bad("Only the sprint under way can be closed");
    const b = req.body ?? {};
    if (b.unfinished !== undefined && b.unfinished !== "next" && b.unfinished !== "backlog") throw bad("Invalid choice");
    const toNext = b.unfinished !== "backlog";
    const row = await tx(async (client) => {
      // Locked: a second close at once waits, then finds it closed.
      const fresh = await one(`SELECT status FROM sprints WHERE id = $1 FOR UPDATE`, [s.id], client);
      if (fresh?.status !== "active") throw bad("Only the sprint under way can be closed");
      const { rows: tasks } = await client.query(`SELECT id, status, points FROM tasks WHERE sprint_id = $1 ORDER BY position`, [s.id]);
      const unfinished = tasks.filter((t) => t.status !== "done" && t.status !== "abandoned");
      const done = tasks.filter((t) => t.status === "done");
      const sum = (list: Row[]) => list.reduce((n, t) => n + (t.points ?? 0), 0);
      let target: Row | null = null;
      if (toNext && unfinished.length) {
        target = await one(`SELECT * FROM sprints WHERE pipe_id = $1 AND status = 'planned' ORDER BY number LIMIT 1`, [p.id], client);
        target ??= await createSprint(client, p, uid);
      }
      for (const t of unfinished) {
        await client.query(`UPDATE tasks SET sprint_id = $2, updated_at = now() WHERE id = $1`, [t.id, target?.id ?? null]);
        await deps.recordSprintChange(client, t.id, uid, sprintChange(s, target));
      }
      const report = {
        committed: s.committed_points ?? 0,
        completed: sum(done),
        done: done.length,
        carried: unfinished.length,
        carriedPoints: sum(unfinished),
        abandoned: tasks.filter((t) => t.status === "abandoned").length,
        carriedTo: ref(target),
      };
      return one(
        `UPDATE sprints SET status = 'closed', completed_points = $2, report = $3, closed_at = now(), closed_by = $4
         WHERE id = $1 RETURNING *`,
        [s.id, report.completed, JSON.stringify(report), uid], client
      );
    });
    notifySpace(p.space_id, { type: "task.updated" }, uid);
    return presentSprint(row!);
  });

  // Only a planned sprint can be deleted: its tasks go back to the backlog.
  app.delete("/sprints/:id", async (req: Req) => {
    const uid = me(req);
    const { s, p } = await loadSprint(req.params.id, uid);
    if (s.status !== "planned") throw bad("Only a planned sprint can be deleted");
    await tx(async (client) => {
      const { rows } = await client.query(`UPDATE tasks SET sprint_id = NULL, updated_at = now() WHERE sprint_id = $1 RETURNING id`, [s.id]);
      for (const t of rows) await deps.recordSprintChange(client, t.id, uid, sprintChange(s, null));
      await client.query(`DELETE FROM sprints WHERE id = $1`, [s.id]);
    });
    notifySpace(p.space_id, { type: "task.updated" }, uid);
    return { ok: true };
  });
}
