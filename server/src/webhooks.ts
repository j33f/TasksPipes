/**
 * Outgoing webhooks of a pipe: chosen task events are POSTed as JSON to a URL, signed with HMAC-SHA256. Deliveries
 * are written with the history entry that causes them (same transaction), then sent by a background pass and retried
 * with growing delays. The same protections as for Outline servers apply to their URLs: https, no internal address
 * (checked when connecting), no redirects; WEBHOOK_ALLOW_PRIVATE lifts the last ones for a receiver on the network.
 * Confidential and team-only pipes have none: their content stays in the app.
 */
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { one, query, type Queryable, type Row } from "./db.js";
import { bad, notFound } from "./errors.js";
import { getTaskRow, isConfidential, memberRole } from "./access.js";
import { decrypt, encrypt } from "./auth.js";
import { TASK_KEY_PREFIX } from "./git.js";
import { guardedLookup, isPrivateIp, postJson } from "./net.js";
import { pipeTypeById, stageLabel } from "./pipeTypes.js";
import { LIMITS, rateLimited } from "./rate-limit.js";

export const EVENTS = ["task.created", "task.moved", "task.assigned", "task.commented", "task.done"] as const;
export type WebhookEvent = (typeof EVENTS)[number];
/** Delays before each new attempt; after the last one, the delivery is given up. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
const KEEP_DELIVERIES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Seam for the tests: how a delivery is sent. */
export const webhookTransport = {
  post: (url: string, headers: Record<string, string>, body: string) =>
    postJson(url, headers, body, guardedLookup(config.webhookAllowPrivate), { timeoutMs: 10_000, maxResponse: 64 * 1024 }),
};

const confidentialKind = (kind: string | null | undefined) => {
  const p = pipeTypeById(kind);
  return Boolean(p?.confidential || p?.teamOnly);
};

/** The task events a history entry stands for. */
export function eventsOf(e: Row): WebhookEvent[] {
  const out: WebhookEvent[] = [];
  if (e.type === "created") out.push("task.created");
  else if (e.from_pipe_id !== e.to_pipe_id || e.from_stage !== e.to_stage) out.push("task.moved");
  if (e.to_assignee_id && e.to_assignee_id !== e.from_assignee_id && e.type !== "created") out.push("task.assigned");
  if (e.comment && e.type !== "refused") out.push("task.commented");
  if (e.to_status === "done" && e.from_status !== "done") out.push("task.done");
  return out;
}

/** What a delivery carries: the task as it is, and the change. */
function payload(event: WebhookEvent | "ping", e: Row | null, t: Row | null, hook: Row) {
  const owner = t ? (t.space_user_id ? { id: t.space_user_id, name: t.space_name } : t.assignee_id ? { id: t.assignee_id, name: t.assignee_name } : null) : null;
  return {
    event,
    occurredAt: (e?.created_at ? new Date(e.created_at) : new Date()).toISOString(),
    pipe: { id: hook.pipe_id, name: hook.pipe_name },
    ...(t && e ? {
      task: {
        id: t.id, key: `${TASK_KEY_PREFIX}-${t.number}`, title: t.title, status: t.status,
        column: stageLabel(t.pipe_kind, t.stage), owner, dueDate: t.due_date,
        url: t.pipe_id ? `${config.appUrl}/pipes/${t.pipe_id}?task=${t.id}` : `${config.appUrl}/spaces/${t.space_id}?task=${t.id}`,
      },
      actor: { id: e.actor_id, name: e.actor_name },
      change: {
        from: { pipeId: e.from_pipe_id, column: e.from_stage, status: e.from_status, ownerId: e.from_assignee_id, dueDate: e.from_due_date },
        to: { pipeId: e.to_pipe_id, column: e.to_stage, status: e.to_status, ownerId: e.to_assignee_id, dueDate: e.to_due_date },
      },
      ...(event === "task.commented" ? { comment: e.comment } : {}),
    } : {}),
  };
}

/** Queues the deliveries a history entry causes, in its transaction: for the pipes it left and entered. */
export async function queueWebhooks(db: Queryable, eventId: number) {
  const e = await one(`SELECT e.*, a.name AS actor_name FROM task_events e JOIN users a ON a.id = e.actor_id WHERE e.id = $1`, [eventId], db);
  const events = e ? eventsOf(e) : [];
  const pipes = [...new Set([e?.from_pipe_id, e?.to_pipe_id].filter(Boolean))];
  if (!events.length || !pipes.length) return;
  const { rows: hooks } = await db.query(
    `SELECT h.id, h.pipe_id, h.events, p.name AS pipe_name, p.kind AS pipe_kind FROM pipe_webhooks h JOIN pipes p ON p.id = h.pipe_id
     WHERE h.pipe_id = ANY($1) AND h.active AND h.events && $2`,
    [pipes, events]
  );
  if (!hooks.length) return;
  const t = await getTaskRow(e!.task_id, db);
  if (!t || isConfidential(t)) return;
  for (const hook of hooks) {
    if (confidentialKind(hook.pipe_kind)) continue;
    for (const event of events.filter((x) => hook.events.includes(x))) {
      await db.query(`INSERT INTO webhook_deliveries (webhook_id, event, payload) VALUES ($1, $2, $3)`, [hook.id, event, JSON.stringify(payload(event, e!, t, hook))]);
    }
  }
}

/** The signature header of a body sent at `timestamp` (seconds): HMAC-SHA256 of "timestamp.body". */
export const signature = (secret: string, timestamp: number, body: string) =>
  `sha256=${crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

/** Sends the deliveries due (of active webhooks), each claimed for a while so that two passes never send it twice. */
export async function runWebhooks(now = new Date()): Promise<number> {
  const { rows } = await query(
    `UPDATE webhook_deliveries d SET next_attempt_at = $1::timestamptz + interval '10 minutes'
     FROM pipe_webhooks h
     WHERE d.id IN (SELECT x.id FROM webhook_deliveries x JOIN pipe_webhooks w ON w.id = x.webhook_id AND w.active
                    WHERE x.delivered_at IS NULL AND x.failed_at IS NULL
                      -- Deliveries are dated by the database: its clock counts too.
                      AND x.next_attempt_at <= GREATEST($1::timestamptz, now())
                    ORDER BY x.id LIMIT 50 FOR UPDATE OF x SKIP LOCKED)
       AND h.id = d.webhook_id
     RETURNING d.id, d.event, d.payload, d.attempts, h.url, h.secret`,
    [now]
  );
  let delivered = 0;
  // In the order they were written (RETURNING keeps none).
  for (const d of rows.sort((a, b) => Number(a.id) - Number(b.id))) {
    const body = JSON.stringify({ id: String(d.id), ...d.payload });
    const ts = Math.floor(now.getTime() / 1000);
    let status: number | null = null;
    let error: string | null = null;
    try {
      if (!allowedScheme(d.url)) throw Object.assign(new Error("https only"), { code: "ESCHEME" });
      const res = await webhookTransport.post(d.url, {
        "Content-Type": "application/json",
        "User-Agent": `TasksPipes/${config.version}`,
        "X-TasksPipes-Event": d.event,
        "X-TasksPipes-Delivery": String(d.id),
        "X-TasksPipes-Timestamp": String(ts),
        "X-TasksPipes-Signature": signature(decrypt(d.secret)!, ts, body),
      }, body);
      status = res.status;
      if (status < 200 || status >= 300) error = `HTTP ${status}`;
    } catch (err) {
      const code = (err as { code?: string }).code;
      error = code === "EPRIVATE" ? "internal address" : code === "ESCHEME" ? "https only" : String((err as Error).message).slice(0, 200);
    }
    const attempts = d.attempts + 1;
    if (!error) {
      delivered++;
      await query(`UPDATE webhook_deliveries SET attempts = $2, delivered_at = $3, last_status = $4, last_error = NULL WHERE id = $1`, [d.id, attempts, now, status]);
    } else if (attempts > RETRY_DELAYS_MS.length) {
      await query(`UPDATE webhook_deliveries SET attempts = $2, failed_at = $3, last_status = $4, last_error = $5 WHERE id = $1`, [d.id, attempts, now, status, error]);
    } else {
      await query(
        `UPDATE webhook_deliveries SET attempts = $2, next_attempt_at = $3, last_status = $4, last_error = $5 WHERE id = $1`,
        [d.id, attempts, new Date(now.getTime() + RETRY_DELAYS_MS[attempts - 1]), status, error]
      );
    }
  }
  return delivered;
}

/** Keeps the last deliveries of each webhook (those still to send are never removed). */
export async function cleanupWebhookDeliveries() {
  await query(
    `DELETE FROM webhook_deliveries d WHERE (d.delivered_at IS NOT NULL OR d.failed_at IS NOT NULL)
       AND d.id < (SELECT min(id) FROM (SELECT x.id FROM webhook_deliveries x WHERE x.webhook_id = d.webhook_id ORDER BY x.id DESC LIMIT $1) last)`,
    [KEEP_DELIVERIES]
  );
}

// ---------------------------------------------------------------------------
// Managing a pipe's webhooks (members of its space)

const allowedScheme = (url: string) => url.startsWith("https://") || (config.webhookAllowPrivate && url.startsWith("http://"));

/** A receiver's URL: https, without credentials, not on an internal address (checked again at each delivery). */
export async function cleanUrl(input: unknown): Promise<string> {
  const raw = typeof input === "string" ? input.trim() : "";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw bad("Invalid address");
  }
  if (raw.length > 2000 || u.username || u.password) throw bad("Invalid address");
  if (!allowedScheme(u.href)) throw bad("A webhook address must use https://");
  if (!config.webhookAllowPrivate) {
    const host = u.hostname.replace(/^\[|\]$/g, "");
    const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (!addresses.length) throw bad("Server not found: {host}", { host });
    if (addresses.some(isPrivateIp)) throw bad("This address is not allowed (internal address).");
  }
  return u.href;
}

function cleanEvents(input: unknown): WebhookEvent[] {
  const events = Array.isArray(input) ? EVENTS.filter((e) => input.includes(e)) : [];
  if (!events.length) throw bad("Choose at least one event");
  return events;
}

/** The pipe, for a member of its space; unknown to anyone else. Confidential pipes have no webhook. */
async function pipeForMember(pipeId: string, userId: string) {
  const p = UUID.test(pipeId) ? await one(`SELECT id, space_id, kind FROM pipes WHERE id = $1`, [pipeId]) : null;
  if (!p || !(await memberRole(p.space_id, userId))) throw notFound("Pipe not found");
  if (confidentialKind(p.kind)) throw bad("A confidential pipe has no webhooks: its content stays in the app.");
  return p;
}

async function webhookForMember(id: string, userId: string) {
  const h = UUID.test(id) ? await one(`SELECT id, pipe_id FROM pipe_webhooks WHERE id = $1`, [id]) : null;
  if (!h) throw notFound("Not found");
  await pipeForMember(h.pipe_id, userId).catch(() => {
    throw notFound("Not found");
  });
  return h;
}

const present = (h: Row, deliveries: Row[]) => ({
  id: h.id,
  url: h.url,
  events: h.events,
  active: h.active,
  // Encrypted at rest; members see it, to check signatures.
  secret: decrypt(h.secret),
  createdAt: h.created_at,
  deliveries: deliveries.map((d) => ({
    id: String(d.id), event: d.event, attempts: d.attempts, createdAt: d.created_at,
    state: d.delivered_at ? "delivered" : d.failed_at ? "failed" : "pending",
    status: d.last_status, error: d.last_error, deliveredAt: d.delivered_at, nextAttemptAt: d.delivered_at || d.failed_at ? null : d.next_attempt_at,
  })),
});

export async function webhookRoutes(app: FastifyInstance) {
  const me = (req: FastifyRequest) => req.user!.id;

  app.get<{ Params: { id: string } }>("/pipes/:id/webhooks", async (req) => {
    const p = await pipeForMember(req.params.id, me(req));
    const { rows } = await query(`SELECT * FROM pipe_webhooks WHERE pipe_id = $1 ORDER BY created_at`, [p.id]);
    return Promise.all(rows.map(async (h) => {
      const d = await query(`SELECT * FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY id DESC LIMIT 20`, [h.id]);
      return present(h, d.rows);
    }));
  });

  app.post<{ Params: { id: string }; Body: { url?: string; events?: string[] } }>("/pipes/:id/webhooks", rateLimited(LIMITS.webhooks), async (req) => {
    const p = await pipeForMember(req.params.id, me(req));
    const url = await cleanUrl(req.body?.url);
    const events = cleanEvents(req.body?.events);
    const secret = crypto.randomBytes(32).toString("hex");
    const h = await one(
      `INSERT INTO pipe_webhooks (pipe_id, url, secret, events, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [p.id, url, encrypt(secret), events, me(req)]
    );
    req.log.info({ webhookId: h!.id, pipeId: p.id }, "Webhook created");
    return present(h!, []);
  });

  app.patch<{ Params: { id: string }; Body: { url?: string; events?: string[]; active?: boolean; newSecret?: boolean } }>(
    "/webhooks/:id", rateLimited(LIMITS.webhooks), async (req) => {
      const h = await webhookForMember(req.params.id, me(req));
      const b = req.body ?? {};
      const url = b.url !== undefined ? await cleanUrl(b.url) : null;
      const events = b.events !== undefined ? cleanEvents(b.events) : null;
      const secret = b.newSecret ? encrypt(crypto.randomBytes(32).toString("hex")) : null;
      const row = await one(
        `UPDATE pipe_webhooks SET url = COALESCE($2, url), events = COALESCE($3, events), active = COALESCE($4, active),
           secret = COALESCE($5, secret), updated_at = now() WHERE id = $1 RETURNING *`,
        [h.id, url, events, typeof b.active === "boolean" ? b.active : null, secret]
      );
      return present(row!, []);
    }
  );

  app.delete<{ Params: { id: string } }>("/webhooks/:id", async (req) => {
    const h = await webhookForMember(req.params.id, me(req));
    await query(`DELETE FROM pipe_webhooks WHERE id = $1`, [h.id]);
    return { ok: true };
  });

  // A "ping" delivery, to try the receiver.
  app.post<{ Params: { id: string } }>("/webhooks/:id/ping", rateLimited(LIMITS.webhooks), async (req) => {
    const h = await webhookForMember(req.params.id, me(req));
    const hook = await one(`SELECT h.pipe_id, p.name AS pipe_name FROM pipe_webhooks h JOIN pipes p ON p.id = h.pipe_id WHERE h.id = $1`, [h.id]);
    await query(`INSERT INTO webhook_deliveries (webhook_id, event, payload) VALUES ($1, 'ping', $2)`, [h.id, JSON.stringify(payload("ping", null, null, hook!))]);
    return { ok: true };
  });
}
