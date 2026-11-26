/**
 * Editing locks on tasks, for the web app: the first page that opens a task it may edit holds it, the others show it
 * read-only ("Opened by X") until it is released. A page keeps its lock by saying so every 20 s (PUT); one that stopped
 * (closed, asleep) loses it after LOCK_SECONDS.
 *
 * Someone else may claim it: the holder is asked to hand it over, and may accept or refuse; without an answer within
 * CLAIM_SECONDS it goes to the one who asked. Nothing runs on a timer: each call first settles what has expired, and
 * the page that claimed calls again once the delay is over.
 *
 * Only the pages of the app lock: an access token (an agent over MCP, the API) changes the task anyway, and the page
 * that holds it reloads it. A session editing a task someone else holds is refused (assertEditable).
 *
 * Pages learn of changes through the live connection: "lock" events to the task's space (and to the people concerned,
 * who may not be members), with what happened; they then fetch the state.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { one, tx, type Queryable, type Row } from "./db.js";
import { HttpError, bad, forbidden } from "./errors.js";
import { notifySpace, notifyUser } from "./realtime.js";
import { viaToken } from "./via.js";
import type { TaskPermissions } from "./access.js";

/** A lock is kept this long after its page last said so (pages say so every 20 s; hidden tabs are slowed down). */
export const LOCK_SECONDS = 90;
/** A claim left unanswered this long hands the lock over. */
export const CLAIM_SECONDS = 30;

const CLIENT = /^[A-Za-z0-9_-]{8,64}$/;

export interface LockState {
  /** Who edits the task now; null: nobody. */
  holder: { id: string; name: string; avatarUrl: string | null } | null;
  /** This page holds it. */
  mine: boolean;
  /** Someone asked for it, and how long the holder has left to answer. */
  claim: { by: { id: string; name: string }; mine: boolean; secondsLeft: number } | null;
}

export type LockChange = "taken" | "released" | "claimed" | "granted" | "refused" | "handedOver";
type Change = { change: LockChange; people: (string | null | undefined)[] } | null;

export interface LockDeps {
  loadTaskFor: (id: string, userId: string, need?: keyof TaskPermissions) => Promise<{ t: Row; perms: TaskPermissions }>;
}

type Req = FastifyRequest<{ Params: Record<string, string>; Body: Record<string, unknown> | undefined; Querystring: Record<string, string> }>;

const cleanClient = (v: unknown) => {
  if (typeof v !== "string" || !CLIENT.test(v)) throw bad("Invalid page");
  return v;
};

const HAND_OVER = `UPDATE task_locks SET user_id = claim_user_id, client_id = claim_client_id, seen_at = now(),
  claim_user_id = NULL, claim_client_id = NULL, claimed_at = NULL WHERE task_id = $1 RETURNING *`;

/**
 * Drops an expired lock and hands over one claimed without an answer, under a row lock. Returns the lock left (or
 * null) and what changed, to tell the pages.
 */
async function settle(db: Queryable, taskId: string): Promise<{ lock: Row | null; change: Change }> {
  const lock = await one(
    `SELECT *, seen_at < now() - interval '${LOCK_SECONDS} seconds' AS expired,
            claimed_at < now() - interval '${CLAIM_SECONDS} seconds' AS claim_due
     FROM task_locks WHERE task_id = $1 FOR UPDATE`,
    [taskId],
    db
  );
  if (!lock) return { lock: null, change: null };
  // Gone, or not answering a claim: whoever claimed gets it, else nobody.
  if (lock.claim_user_id && (lock.expired || lock.claim_due)) {
    const fresh = await one(HAND_OVER, [taskId], db);
    return { lock: fresh, change: { change: "handedOver", people: [lock.user_id, lock.claim_user_id] } };
  }
  if (lock.expired) {
    await db.query(`DELETE FROM task_locks WHERE task_id = $1`, [taskId]);
    return { lock: null, change: { change: "released", people: [lock.user_id] } };
  }
  return { lock, change: null };
}

async function present(db: Queryable, lock: Row | null, uid: string, client: string | null): Promise<LockState> {
  if (!lock) return { holder: null, mine: false, claim: null };
  const people = await db.query(`SELECT id, name, avatar_url FROM users WHERE id = ANY($1::uuid[])`, [
    [lock.user_id, lock.claim_user_id].filter(Boolean),
  ]);
  const person = (id: string) => people.rows.find((r) => r.id === id);
  const holder = person(lock.user_id);
  const claimer = lock.claim_user_id ? person(lock.claim_user_id) : null;
  const claimedAt = lock.claimed_at ? new Date(lock.claimed_at).getTime() : 0;
  return {
    holder: holder ? { id: holder.id, name: holder.name, avatarUrl: holder.avatar_url ?? null } : null,
    mine: lock.user_id === uid && lock.client_id === client,
    claim: claimer
      ? {
          by: { id: claimer.id, name: claimer.name },
          mine: lock.claim_user_id === uid && lock.claim_client_id === client,
          secondsLeft: Math.max(0, Math.ceil(CLAIM_SECONDS - (Date.now() - claimedAt) / 1000)),
        }
      : null,
  };
}

/** Tells the pages showing the task (its space's members, and those concerned) that its lock changed. */
function tell(t: Row, c: Change, by: string) {
  if (!c) return;
  const event = { type: "lock" as const, task: { id: t.id, number: t.number, title: t.title }, change: c.change, by };
  void notifySpace(t.space_id, event);
  for (const id of new Set(c.people.filter((p): p is string => Boolean(p)))) notifyUser(id, event);
}

/**
 * For a change made from a page of the app: refused when someone else holds the task (an access token, an agent over
 * MCP, goes through). The same person in another tab of theirs is not stopped, nor the one whose claim is due.
 */
export async function assertEditable(taskId: string, uid: string, db?: Queryable) {
  if (viaToken()) return;
  const lock = await one(
    `SELECT u.name FROM task_locks l JOIN users u ON u.id = l.user_id
     WHERE l.task_id = $1 AND l.user_id <> $2 AND l.seen_at > now() - interval '${LOCK_SECONDS} seconds'
       AND NOT (l.claim_user_id IS NOT DISTINCT FROM $2 AND l.claimed_at < now() - interval '${CLAIM_SECONDS} seconds')`,
    [taskId, uid],
    db
  );
  if (lock) throw new HttpError(409, "{name} is editing this task", { name: lock.name });
}

export async function lockRoutes(app: FastifyInstance, deps: LockDeps) {
  const me = (req: FastifyRequest) => req.user!.id;
  const nameOf = (req: FastifyRequest) => req.user!.name;
  const take = (db: Queryable, taskId: string, uid: string, client: string) =>
    one(`INSERT INTO task_locks (task_id, user_id, client_id) VALUES ($1, $2, $3) RETURNING *`, [taskId, uid, client], db);
  const holds = (lock: Row | null, uid: string, client: string) => Boolean(lock) && lock!.user_id === uid && lock!.client_id === client;
  const claims = (lock: Row | null, uid: string, client: string) =>
    Boolean(lock) && lock!.claim_user_id === uid && lock!.claim_client_id === client;

  /** The task, for someone who may change it; locking is for the pages of the app only. */
  async function editable(req: Req) {
    if (viaToken()) throw forbidden("Only the pages of the app lock tasks");
    const { t, perms } = await deps.loadTaskFor(req.params.id, me(req));
    if (!perms.editContent && !perms.manage) throw forbidden();
    return t;
  }

  // Current state, without taking it (pages that only read).
  app.get("/tasks/:id/lock", async (req: Req) => {
    const uid = me(req);
    const { t } = await deps.loadTaskFor(req.params.id, uid);
    const client = typeof req.query.client === "string" && CLIENT.test(req.query.client) ? req.query.client : null;
    const { state, change } = await tx(async (db) => {
      const s = await settle(db, t.id);
      return { state: await present(db, s.lock, uid, client), change: s.change };
    });
    tell(t, change, nameOf(req));
    return state;
  });

  // Takes the task when nobody holds it, or keeps it (every 20 s).
  app.put("/tasks/:id/lock", async (req: Req) => {
    const uid = me(req);
    const t = await editable(req);
    const client = cleanClient(req.body?.client);
    const { state, changes } = await tx(async (db) => {
      const s = await settle(db, t.id);
      const changes: Change[] = [s.change];
      let lock = s.lock;
      if (!lock) {
        lock = await take(db, t.id, uid, client);
        changes.push({ change: "taken", people: [] });
      } else if (holds(lock, uid, client)) {
        lock = await one(`UPDATE task_locks SET seen_at = now() WHERE task_id = $1 RETURNING *`, [t.id], db);
      }
      return { state: await present(db, lock, uid, client), changes };
    });
    for (const c of changes) tell(t, c, nameOf(req));
    return state;
  });

  // Releases it (the page closes the task): a claim waiting for it gets it at once. A claim of this page is withdrawn.
  app.delete("/tasks/:id/lock", async (req: Req) => {
    const uid = me(req);
    const { t } = await deps.loadTaskFor(req.params.id, uid);
    const client = cleanClient(req.query.client);
    const changes = await tx(async (db): Promise<Change[]> => {
      const s = await settle(db, t.id);
      const lock = s.lock;
      if (holds(lock, uid, client)) {
        if (lock!.claim_user_id) {
          await db.query(HAND_OVER, [t.id]);
          return [s.change, { change: "granted", people: [lock!.claim_user_id] }];
        }
        await db.query(`DELETE FROM task_locks WHERE task_id = $1`, [t.id]);
        return [s.change, { change: "released", people: [] }];
      }
      if (claims(lock, uid, client)) {
        await db.query(`UPDATE task_locks SET claim_user_id = NULL, claim_client_id = NULL, claimed_at = NULL WHERE task_id = $1`, [t.id]);
        return [s.change, { change: "released", people: [lock!.user_id] }];
      }
      return [s.change];
    });
    for (const c of changes) tell(t, c, nameOf(req));
    return { ok: true };
  });

  // Asks the one who holds it to hand it over.
  app.post("/tasks/:id/lock/claim", async (req: Req) => {
    const uid = me(req);
    const t = await editable(req);
    const client = cleanClient(req.body?.client);
    const { state, changes } = await tx(async (db) => {
      const s = await settle(db, t.id);
      const changes: Change[] = [s.change];
      let lock = s.lock;
      if (!lock) {
        // Free meanwhile: taken at once.
        lock = await take(db, t.id, uid, client);
        changes.push({ change: "taken", people: [] });
      } else if (!holds(lock, uid, client) && !claims(lock, uid, client)) {
        if (lock.claim_user_id) {
          const other = await one(`SELECT name FROM users WHERE id = $1`, [lock.claim_user_id], db);
          throw new HttpError(409, "{name} already asked for it", { name: other?.name ?? "" });
        }
        lock = await one(
          `UPDATE task_locks SET claim_user_id = $2, claim_client_id = $3, claimed_at = now() WHERE task_id = $1 RETURNING *`,
          [t.id, uid, client],
          db
        );
        changes.push({ change: "claimed", people: [lock!.user_id] });
      }
      return { state: await present(db, lock, uid, client), changes };
    });
    for (const c of changes) tell(t, c, nameOf(req));
    return state;
  });

  // The holder's answer: hands it over, or keeps it.
  app.post("/tasks/:id/lock/answer", async (req: Req) => {
    const uid = me(req);
    const t = await editable(req);
    const client = cleanClient(req.body?.client);
    if (typeof req.body?.accept !== "boolean") throw bad("Invalid answer");
    const accept = req.body.accept;
    const { state, changes } = await tx(async (db) => {
      const s = await settle(db, t.id);
      const changes: Change[] = [s.change];
      let lock = s.lock;
      if (holds(lock, uid, client) && lock!.claim_user_id) {
        const claimer = lock!.claim_user_id;
        lock = await one(
          accept ? HAND_OVER : `UPDATE task_locks SET claim_user_id = NULL, claim_client_id = NULL, claimed_at = NULL WHERE task_id = $1 RETURNING *`,
          [t.id],
          db
        );
        changes.push({ change: accept ? "granted" : "refused", people: [claimer] });
      }
      return { state: await present(db, lock, uid, client), changes };
    });
    for (const c of changes) tell(t, c, nameOf(req));
    return state;
  });
}
