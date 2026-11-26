/**
 * Live notifications over WebSocket (GET /api/events), authenticated by the session cookie.
 * The page closes its socket when left idle and reopens it on return; nothing is queued meanwhile:
 * on reconnecting, the page reloads its data.
 *
 * Several instances of the app (docs/KUBERNETES.md): each one delivers to the pages connected to it first, as a
 * single instance does, then passes the event on to the others through PostgreSQL (NOTIFY on one channel, every
 * instance LISTENs), which deliver it to theirs. Who has a page open is kept in `live_presence` the same way.
 * REALTIME_SHARED=false turns both off; a lost LISTEN connection only stops what comes from the other instances.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "@fastify/websocket";
import { config } from "./config.js";
import { one, query } from "./db.js";

const sockets = new Map<string, Set<WebSocket>>();
const alive = new WeakSet<WebSocket>();

/** This process, among the instances sharing the database. */
const INSTANCE = randomUUID();
const CHANNEL = "taskspipes_live";
/** NOTIFY payloads are limited to 8000 bytes. */
const MAX_PAYLOAD = 7900;
/** A page counts as open on another instance while that instance saw it within this delay (it refreshes every 30 s). */
const PRESENCE_TTL = "90 seconds";
const RETRY_MS = 5_000;

export interface LiveEvent {
  /**
   * task.sent: a task arrived in an incoming bucket; task.refused: one came back; incoming.changed: one left;
   * task.updated: a task of the space changed; inbox: one's in-app notifications changed; lock: who edits a task
   * changed (locks.ts).
   */
  type: "inbox" | "task.sent" | "task.refused" | "incoming.changed" | "task.updated" | "connection.request" | "connection.accepted" | "mention" | "unblocked" | "hello" | "poker" | "lock";
  /** task.updated: the task that changed, who changed it, and whether through their AI agent or an access token. */
  taskId?: string;
  actorId?: string;
  via?: "agent" | "token";
  /** lock: what happened (locks.ts LockChange). */
  change?: string;
  /** poker: the pipe whose session changed; whether it opened or closed (the pipe's page shows it). */
  pipeId?: string;
  opened?: boolean;
  spaceId?: string;
  task?: { id: string; number: number; title: string };
  by?: string;
  reason?: string;
}

/** What instances pass on to each other. */
type Shared =
  | { kind: "user"; userId: string; message: string }
  | { kind: "space"; spaceId: string; except?: string; message: string }
  | { kind: "close"; userId: string };

export async function realtime(app: FastifyInstance) {
  await app.register(websocket, { options: { maxPayload: 1024 } });

  app.get("/api/events", { websocket: true }, (socket, req) => {
    // Same-origin pages only, and signed in.
    const origin = req.headers.origin;
    if (!req.user || (origin && origin !== new URL(config.appUrl).origin)) {
      socket.close(4401, "unauthorized");
      return;
    }
    const userId = req.user.id;
    let set = sockets.get(userId);
    if (!set) {
      sockets.set(userId, (set = new Set()));
      presence("on", userId);
    }
    set.add(socket);
    alive.add(socket);
    socket.on("pong", () => alive.add(socket));
    // First message: the server's version, so pages left open across an update notice it.
    socket.send(JSON.stringify({ type: "hello", version: config.version }));
    socket.on("message", () => {}); // nothing is expected from the page
    socket.on("close", () => {
      set!.delete(socket);
      // The set may already be gone (closeUserConnections) and replaced by a newer page's.
      if (!set!.size && sockets.get(userId) === set) {
        sockets.delete(userId);
        presence("off", userId);
      }
    });
  });

  // Drops connections that stopped answering (sleeping phone, lost network), and tells the other instances who
  // is still here.
  const timer = setInterval(() => {
    for (const set of sockets.values()) {
      for (const s of set) {
        if (!alive.has(s)) {
          s.terminate();
          continue;
        }
        alive.delete(s);
        s.ping();
      }
    }
    refreshPresence();
    void closeDisabled();
  }, 30_000);
  timer.unref();

  if (config.realtimeShared) {
    const shared = listen(app.log);
    app.addHook("onClose", async () => {
      await shared.stop();
      await query(`DELETE FROM live_presence WHERE instance_id = $1`, [INSTANCE]).catch(() => {});
    });
  }
  app.addHook("onClose", async () => clearInterval(timer));
}

// ---- Delivery to the pages connected to this instance ----------------------------------------------------------

function sendToUser(userId: string, message: string) {
  for (const s of sockets.get(userId) ?? []) if (s.readyState === s.OPEN) s.send(message);
}

async function sendToSpace(spaceId: string, message: string, exceptUserId?: string) {
  if (!sockets.size) return;
  try {
    const { rows } = await query(`SELECT user_id FROM space_members WHERE space_id = $1`, [spaceId]);
    for (const { user_id } of rows) if (user_id !== exceptUserId) sendToUser(user_id, message);
  } catch {
    // Live updates are a convenience: the page also reloads its data when it comes back.
  }
}

function closeLocal(userId: string) {
  const set = sockets.get(userId);
  if (!set) return;
  sockets.delete(userId);
  presence("off", userId);
  for (const s of set) s.close(4401, "unauthorized");
}

// ---- Sharing with the other instances ---------------------------------------------------------------------------

/** Passes an event on to the other instances. Never throws, never waits. */
function publish(m: Shared) {
  if (!config.realtimeShared) return;
  const payload = JSON.stringify({ from: INSTANCE, ...m });
  if (Buffer.byteLength(payload) > MAX_PAYLOAD) return;
  query(`SELECT pg_notify($1, $2)`, [CHANNEL, payload]).catch(() => {});
}

const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * An event from another instance, for the pages connected here. Anything else that can NOTIFY on the database could
 * send one too: whatever does not have the expected shape is ignored, and nothing here may throw (it would stop the
 * process from the LISTEN connection's handler).
 */
function receive(payload: string) {
  try {
    const m = JSON.parse(payload) as { from?: unknown; kind?: unknown; message?: unknown; userId?: unknown; spaceId?: unknown; except?: unknown } | null;
    if (!m || typeof m !== "object" || m.from === INSTANCE) return; // already delivered here
    if (m.kind === "user" && isText(m.userId) && isText(m.message)) sendToUser(m.userId, m.message);
    else if (m.kind === "space" && isText(m.spaceId) && isText(m.message)) {
      void sendToSpace(m.spaceId, m.message, isText(m.except) ? m.except : undefined);
    } else if (m.kind === "close" && isText(m.userId)) closeLocal(m.userId);
  } catch {
    /* not an event of ours */
  }
}

/** LISTENs on its own connection, and keeps trying when it is lost. */
function listen(log: FastifyBaseLogger) {
  let client: pg.Client | undefined;
  let retry: NodeJS.Timeout | undefined;
  let stopped = false;
  let failing = false;

  const later = () => {
    if (!stopped) retry = setTimeout(connect, RETRY_MS).unref();
  };
  const connect = async () => {
    const c = new pg.Client({ connectionString: config.listenDatabaseUrl });
    c.on("notification", (n) => {
      if (n.channel === CHANNEL && n.payload) receive(n.payload);
    });
    c.on("error", () => {}); // followed by "end"
    c.on("end", () => {
      if (client !== c) return;
      client = undefined;
      if (stopped) return;
      failing = true;
      log.warn("Live updates from the other instances interrupted, reconnecting");
      later();
    });
    try {
      await c.connect();
      await c.query(`LISTEN ${CHANNEL}`);
      if (stopped) return void c.end().catch(() => {});
      client = c;
      if (failing) log.info("Live updates from the other instances back");
      failing = false;
    } catch (err) {
      c.end().catch(() => {});
      // Said once, not every 5 seconds.
      if (!failing) log.warn({ err }, "Cannot listen for the other instances' live updates (REALTIME_SHARED, LISTEN_DATABASE_URL), retrying");
      failing = true;
      later();
    }
  };
  void connect();

  return {
    async stop() {
      stopped = true;
      clearTimeout(retry);
      const c = client;
      client = undefined;
      await c?.end().catch(() => {});
    },
  };
}

/** Records, for the other instances, that someone has a page open here or no longer. Never throws, never waits. */
function presence(state: "on" | "off", userId: string) {
  if (!config.realtimeShared) return;
  const sql =
    state === "on"
      ? `INSERT INTO live_presence (instance_id, user_id) VALUES ($1, $2)
         ON CONFLICT (user_id, instance_id) DO UPDATE SET seen_at = now()`
      : `DELETE FROM live_presence WHERE instance_id = $1 AND user_id = $2`;
  query(sql, [INSTANCE, userId]).catch(() => {});
}

/**
 * Every 30 s: pages of accounts disabled meanwhile are closed, should the word from the instance that disabled them
 * have been lost (LISTEN connection down, a payload too large).
 */
async function closeDisabled() {
  const here = [...sockets.keys()];
  if (!here.length) return;
  try {
    const { rows } = await query(`SELECT id FROM users WHERE id = ANY($1::uuid[]) AND disabled_at IS NOT NULL`, [here]);
    for (const r of rows) closeLocal(r.id);
  } catch {
    /* next time */
  }
}

/** Every 30 s: the people with a page open here are still here; anyone else recorded for this instance is not. */
function refreshPresence() {
  if (!config.realtimeShared) return;
  const here = [...sockets.keys()];
  query(
    `WITH gone AS (DELETE FROM live_presence WHERE instance_id = $1 AND NOT (user_id = ANY($2::uuid[])))
     INSERT INTO live_presence (instance_id, user_id) SELECT $1, u FROM unnest($2::uuid[]) AS u
     WHERE EXISTS (SELECT 1 FROM users WHERE id = u)
     ON CONFLICT (user_id, instance_id) DO UPDATE SET seen_at = now()`,
    [INSTANCE, here]
  ).catch(() => {});
  // What instances that stopped without a word (a crash) left behind.
  query(`DELETE FROM live_presence WHERE seen_at < now() - interval '1 hour'`).catch(() => {});
}

// ---- What the rest of the app calls -----------------------------------------------------------------------------

/** Notifies one person (all their open pages, on every instance). */
export function notifyUser(userId: string, event: LiveEvent) {
  const message = JSON.stringify(event);
  sendToUser(userId, message);
  publish({ kind: "user", userId, message });
}

/** Notifies the members of a space (but not the person who acted), on every instance. Never throws. */
export async function notifySpace(spaceId: string, event: Omit<LiveEvent, "spaceId">, exceptUserId?: string) {
  const message = JSON.stringify({ ...event, spaceId });
  await sendToSpace(spaceId, message, exceptUserId);
  publish({ kind: "space", spaceId, except: exceptUserId, message });
}

/** Closes the open pages of someone whose access ended (disabled, deleted, signed out by Outline), on every instance. */
export function closeUserConnections(userId: string) {
  closeLocal(userId);
  publish({ kind: "close", userId });
}

/**
 * Whether someone has a page of the app open and in use (pages close their connection when left idle), here or on
 * another instance.
 */
export async function isOnline(userId: string): Promise<boolean> {
  if ((sockets.get(userId)?.size ?? 0) > 0) return true;
  if (!config.realtimeShared) return false;
  try {
    return Boolean(
      await one(
        `SELECT 1 FROM live_presence WHERE user_id = $1 AND instance_id <> $2 AND seen_at > now() - interval '${PRESENCE_TTL}'`,
        [userId, INSTANCE]
      )
    );
  } catch {
    return false;
  }
}
