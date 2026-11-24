/**
 * Planning Poker, in the team pipes where it is on (PipeType.planningPoker by default, pipes.poker to change it):
 * the members of the team estimate tasks together. A member opens a session with the tasks to estimate and leads it;
 * for the task under estimation, everyone picks a card, hidden from the others — the server sends no one's value
 * before the cards are shown, only who voted. The one who leads shows the cards (with their spread and a suggestion),
 * starts another round if they differ too much, then sets the points: they go on the task, noted in its history, and
 * the next task comes. Anyone of the team may take the lead, or close the session.
 *
 * Pages learn of each change through the live connection ("poker" events, with no vote in them) and fetch the state.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { one, query, tx, type Queryable, type Row } from "./db.js";
import { bad, forbidden, notFound } from "./errors.js";
import { pipeTypeById } from "./pipeTypes.js";
import { notifySpace } from "./realtime.js";
import { POINTS, cleanPoints, roundPoints } from "./points.js";
import { median } from "./velocity.js";

export const DECK = ["0", "1", "2", "3", "5", "8", "13", "21", "40", "100", "?", "coffee"] as const;
/** At most this many tasks in a session. */
export const MAX_TASKS = 50;
/** Someone counts as at the table while their page said so this recently. */
const PRESENT_SECONDS = 45;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether Planning Poker is on in a pipe: team spaces only; the pipe's choice, else its type's. */
export const pokerEnabled = (p: Row, spaceKind: string) =>
  spaceKind === "team" && (p.poker ?? Boolean(pipeTypeById(p.kind)?.planningPoker));

export interface PokerStats {
  /** Numeric votes only ("?" and coffee left out). */
  count: number;
  min: number | null;
  max: number | null;
  median: number | null;
  /** The value of the scale to suggest: the median, rounded up. */
  suggestion: number | null;
  /** Everyone picked the same number. */
  consensus: boolean;
}

/** What the cards show once revealed. */
export function pokerStats(values: string[]): PokerStats {
  const nums = values.filter((v) => /^\d+$/.test(v)).map(Number);
  if (!nums.length) return { count: 0, min: null, max: null, median: null, suggestion: null, consensus: false };
  const m = median(nums);
  return {
    count: nums.length, min: Math.min(...nums), max: Math.max(...nums), median: m, suggestion: roundPoints(m) ?? null,
    consensus: nums.length === values.length && nums.every((n) => n === nums[0]),
  };
}

export interface PokerDeps {
  loadPipeFor: (id: unknown, userId: string) => Promise<{ p: Row; role: string | null }>;
  /** Sets a task's points, written in its history as estimated at Planning Poker. */
  setPoints: (db: Queryable, taskId: string, actorId: string, points: number) => Promise<void>;
}

type Req = FastifyRequest<{ Params: Record<string, string>; Body: Record<string, unknown> | undefined }>;

const spaceKind = async (spaceId: string, db?: Queryable) => (await one(`SELECT kind FROM spaces WHERE id = $1`, [spaceId], db))!.kind as string;

/** The session as `uid` sees it: the others' votes only once the cards are shown. */
export async function sessionState(s: Row, uid: string, db?: Queryable) {
  const [tasks, people, votes] = await Promise.all([
    query(
      `SELECT t.id, t.number, t.title, t.points, t.task_type, t.status FROM tasks t
       WHERE t.id = ANY($1::uuid[]) AND t.pipe_id = $2 ORDER BY array_position($1::uuid[], t.id)`,
      [s.task_ids, s.pipe_id], db
    ),
    query(
      `SELECT u.id, u.name, u.avatar_url, COALESCE(pp.seen_at > now() - interval '${PRESENT_SECONDS} seconds', false) AS present
       FROM poker_sessions ps JOIN pipes p ON p.id = ps.pipe_id JOIN space_members m ON m.space_id = p.space_id
       JOIN users u ON u.id = m.user_id LEFT JOIN poker_presence pp ON pp.session_id = ps.id AND pp.user_id = u.id
       WHERE ps.id = $1 ORDER BY u.name`,
      [s.id], db
    ),
    s.current_task_id
      ? query(`SELECT user_id, value FROM poker_votes WHERE session_id = $1 AND task_id = $2 AND round = $3`, [s.id, s.current_task_id, s.round], db)
      : Promise.resolve({ rows: [] as Row[] }),
  ]);
  const voteOf = new Map(votes.rows.map((v) => [v.user_id as string, v.value as string]));
  const estimated = (s.estimated ?? {}) as Record<string, number>;
  return {
    id: s.id as string,
    status: s.status as "open" | "closed",
    facilitatorId: s.facilitator_id as string | null,
    tasks: tasks.rows.map((t) => ({
      id: t.id, number: t.number, title: t.title, points: t.points ?? null, taskType: t.task_type, status: t.status,
      estimated: estimated[t.id] ?? null,
    })),
    currentTaskId: s.current_task_id as string | null,
    round: s.round as number,
    revealed: Boolean(s.revealed),
    // The team: those at the table, and those who voted.
    participants: people.rows
      .filter((u) => u.present || voteOf.has(u.id) || u.id === uid)
      .map((u) => ({
        id: u.id, name: u.name, avatarUrl: u.avatar_url, present: Boolean(u.present) || u.id === uid, voted: voteOf.has(u.id),
        vote: s.revealed || u.id === uid ? (voteOf.get(u.id) ?? null) : null,
      })),
    stats: s.revealed ? pokerStats([...voteOf.values()]) : null,
  };
}

export async function pokerRoutes(app: FastifyInstance, deps: PokerDeps) {
  const me = (req: FastifyRequest) => req.user!.id;
  const tell = (spaceId: string, pipeId: string, uid: string, opened?: boolean) =>
    notifySpace(spaceId, { type: "poker", pipeId, ...(opened === undefined ? {} : { opened }) }, uid);

  /** The pipe, for a member of its team, with Planning Poker on. */
  async function pokerPipe(pipeId: unknown, uid: string) {
    const { p, role } = await deps.loadPipeFor(pipeId, uid);
    if (!role) throw forbidden("Only the team's members play Planning Poker");
    if (!pokerEnabled(p, await spaceKind(p.space_id))) throw bad("Planning Poker is off in this pipe");
    return p;
  }

  /** An open session, for a member of its team. */
  async function openSession(id: string, uid: string) {
    const s = UUID.test(id) ? await one(`SELECT * FROM poker_sessions WHERE id = $1`, [id]) : null;
    if (!s) throw notFound("Session not found");
    const p = await pokerPipe(s.pipe_id, uid).catch((err) => {
      throw err?.statusCode === 404 ? notFound("Session not found") : err;
    });
    if (s.status !== "open") throw bad("This session is closed");
    return { s, p };
  }

  const lead = (s: Row, uid: string) => {
    if (s.facilitator_id !== uid) throw forbidden("Only the one who leads the session can do this");
  };

  /** The state after a change, for the one who made it; the others are told to fetch theirs. */
  async function changed(s: Row, p: Row, uid: string, opened?: boolean) {
    tell(p.space_id, p.id, uid, opened);
    const fresh = await one(`SELECT * FROM poker_sessions WHERE id = $1`, [s.id]);
    return sessionState(fresh!, uid);
  }

  // Whether poker is on here, and the open session if any; asking counts as being at the table.
  app.get("/pipes/:id/poker", async (req: Req) => {
    const uid = me(req);
    const { p, role } = await deps.loadPipeFor(req.params.id, uid);
    const enabled = Boolean(role) && pokerEnabled(p, await spaceKind(p.space_id));
    if (!enabled) return { enabled: false, session: null };
    const s = await one(`SELECT * FROM poker_sessions WHERE pipe_id = $1 AND status = 'open'`, [p.id]);
    if (!s) return { enabled, session: null };
    const seen = await one(
      `INSERT INTO poker_presence (session_id, user_id) VALUES ($1, $2)
       ON CONFLICT (session_id, user_id) DO UPDATE SET seen_at = now()
       RETURNING (SELECT seen_at FROM poker_presence WHERE session_id = $1 AND user_id = $2) AS before`, [s.id, uid]
    );
    // Someone sitting down (or back): the others see them.
    if (!seen?.before || Date.now() - new Date(seen.before).getTime() > PRESENT_SECONDS * 1000) tell(p.space_id, p.id, uid);
    return { enabled, session: await sessionState(s, uid) };
  });

  // A session opens with the tasks to estimate, the first one first; whoever opens it leads it.
  app.post("/pipes/:id/poker", async (req: Req) => {
    const uid = me(req);
    const p = await pokerPipe(req.params.id, uid);
    const ids = req.body?.taskIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_TASKS || !ids.every((x) => typeof x === "string" && UUID.test(x))) {
      throw bad("Choose 1 to {n} tasks to estimate", { n: MAX_TASKS });
    }
    const wanted = [...new Set(ids as string[])];
    const { rows } = await query(
      `SELECT id FROM tasks WHERE id = ANY($1::uuid[]) AND pipe_id = $2 AND status NOT IN ('done', 'abandoned')`, [wanted, p.id]
    );
    if (rows.length !== wanted.length) throw bad("Only unfinished tasks of this pipe can be estimated");
    const s = await one(
      `INSERT INTO poker_sessions (pipe_id, facilitator_id, task_ids, current_task_id) VALUES ($1, $2, $3, $4) RETURNING *`,
      [p.id, uid, wanted, wanted[0]]
    ).catch((err) => {
      throw err?.code === "23505" ? bad("A session is already open in this pipe: join it") : err;
    });
    await query(`INSERT INTO poker_presence (session_id, user_id) VALUES ($1, $2)`, [s!.id, uid]);
    return changed(s!, p, uid, true);
  });

  // A card for the task under estimation, until they are shown (picked again: changed; null: taken back).
  app.post("/poker/:id/vote", async (req: Req) => {
    const uid = me(req);
    const { s, p } = await openSession(req.params.id, uid);
    if (!s.current_task_id) throw bad("No task is being estimated");
    if (s.revealed) throw bad("The cards are shown: wait for another round");
    const value = req.body?.value;
    if (value === null) {
      await query(`DELETE FROM poker_votes WHERE session_id = $1 AND task_id = $2 AND round = $3 AND user_id = $4`, [s.id, s.current_task_id, s.round, uid]);
    } else {
      if (!DECK.includes(value as (typeof DECK)[number])) throw bad("Invalid card");
      await query(
        `INSERT INTO poker_votes (session_id, task_id, round, user_id, value) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (session_id, task_id, round, user_id) DO UPDATE SET value = EXCLUDED.value, voted_at = now()`,
        [s.id, s.current_task_id, s.round, uid, value]
      );
    }
    return changed(s, p, uid);
  });

  // The one who leads shows the cards, starts another round, picks the task, sets the points.
  app.post("/poker/:id/reveal", async (req: Req) => {
    const uid = me(req);
    const { s, p } = await openSession(req.params.id, uid);
    lead(s, uid);
    if (!s.current_task_id) throw bad("No task is being estimated");
    await query(`UPDATE poker_sessions SET revealed = true WHERE id = $1`, [s.id]);
    return changed(s, p, uid);
  });

  app.post("/poker/:id/round", async (req: Req) => {
    const uid = me(req);
    const { s, p } = await openSession(req.params.id, uid);
    lead(s, uid);
    await query(`UPDATE poker_sessions SET round = round + 1, revealed = false WHERE id = $1`, [s.id]);
    return changed(s, p, uid);
  });

  app.post("/poker/:id/current", async (req: Req) => {
    const uid = me(req);
    const { s, p } = await openSession(req.params.id, uid);
    lead(s, uid);
    const id = req.body?.taskId;
    if (typeof id !== "string" || !(s.task_ids as string[]).includes(id)) throw bad("This task is not in the session");
    await query(`UPDATE poker_sessions SET current_task_id = $2, round = 1, revealed = false WHERE id = $1`, [s.id, id]);
    return changed(s, p, uid);
  });

  app.post("/poker/:id/estimate", async (req: Req) => {
    const uid = me(req);
    const { s, p } = await openSession(req.params.id, uid);
    lead(s, uid);
    if (!s.current_task_id) throw bad("No task is being estimated");
    const points = cleanPoints(req.body?.points);
    if (points === null) throw bad("Choose the points: {values}", { values: POINTS.join(", ") });
    await tx(async (client) => {
      const task = await one(`SELECT id FROM tasks WHERE id = $1 AND pipe_id = $2`, [s.current_task_id, p.id], client);
      if (!task) throw bad("This task left the pipe");
      await deps.setPoints(client, task.id, uid, points);
      const estimated: Record<string, number> = { ...(s.estimated ?? {}), [task.id]: points };
      // The next task of the queue not estimated yet, after this one, else from the start.
      const queue = s.task_ids as string[];
      const at = queue.indexOf(task.id);
      const next = [...queue.slice(at + 1), ...queue.slice(0, at)].find((id) => !(id in estimated)) ?? null;
      await client.query(
        `UPDATE poker_sessions SET estimated = $2, current_task_id = $3, round = 1, revealed = false WHERE id = $1`,
        [s.id, JSON.stringify(estimated), next]
      );
    });
    return changed(s, p, uid);
  });

  // Anyone of the team may take the lead (the one leading left), or close the session.
  app.post("/poker/:id/lead", async (req: Req) => {
    const uid = me(req);
    const { s, p } = await openSession(req.params.id, uid);
    await query(`UPDATE poker_sessions SET facilitator_id = $2 WHERE id = $1`, [s.id, uid]);
    return changed(s, p, uid);
  });

  app.post("/poker/:id/close", async (req: Req) => {
    const uid = me(req);
    const { s, p } = await openSession(req.params.id, uid);
    await query(`UPDATE poker_sessions SET status = 'closed', closed_at = now() WHERE id = $1`, [s.id]);
    tell(p.space_id, p.id, uid, false);
    return { ok: true };
  });

  // Leaving the table.
  app.post("/poker/:id/leave", async (req: Req) => {
    const uid = me(req);
    const { s, p } = await openSession(req.params.id, uid);
    await query(`DELETE FROM poker_presence WHERE session_id = $1 AND user_id = $2`, [s.id, uid]);
    tell(p.space_id, p.id, uid);
    return { ok: true };
  });
}
