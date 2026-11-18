/**
 * Incoming webhooks: another application (a form, a CRM, Zapier, n8n, a script…) creates tasks in a pipe by POSTing to
 * /hooks/incoming/<token> (routes.ts gitWebhooks). The pipe's member who set it up is the author: the task is made as
 * them, through createTask, with every check of the API. Authenticated by the secret, in a header (X-TasksPipes-Token,
 * or Authorization: Bearer), or by a signature of the body (X-TasksPipes-Signature: sha256=<HMAC of the body>).
 * The body is JSON (or a form): title, description, dueDate, priority, externalId — or other names, picked out by the
 * webhook's templates ("Lead: {{contact.name}}"). An externalId seen before makes no second task.
 */
import crypto from "node:crypto";
import { one, query } from "./db.js";
import { decrypt } from "./crypto-box.js";
import { config } from "./config.js";
import { HttpError, bad } from "./errors.js";
import { createTask } from "./routes.js";
import { enforceLimit } from "./rate-limit.js";
import { tr, type Locale } from "./i18n.js";

/** Templates of a webhook: for each field of the task, text with {{paths}} into the body. Empty: the field of that name. */
export interface IncomingTemplates {
  title?: string;
  description?: string;
  dueDate?: string;
  externalId?: string;
}
const FIELDS = ["title", "description", "dueDate", "externalId"] as const;
const MAX_TEMPLATE = 2000;

/** The templates as one may set them: known fields only, text, not too long. */
export function cleanTemplates(input: unknown): IncomingTemplates {
  const out: IncomingTemplates = {};
  if (!input || typeof input !== "object") return out;
  for (const f of FIELDS) {
    const v = (input as Record<string, unknown>)[f];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string" || v.length > MAX_TEMPLATE) throw bad("Invalid template");
    out[f] = v;
  }
  return out;
}

/** The value at a dotted path ("contact.name", "items.0.title") of the body, or undefined. */
function at(body: unknown, path: string): unknown {
  let cur: unknown = body;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const asText = (v: unknown): string =>
  v === undefined || v === null ? "" : Array.isArray(v) ? v.map(asText).join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);

/** A template filled from the body: each {{path}} replaced by its value (nothing when absent). */
export function render(template: string, body: unknown): string {
  return template.replace(/\{\{\s*([\w.-]{1,200})\s*\}\}/g, (_m, path: string) => asText(at(body, path)));
}

/** What the task gets from the body, through the templates or the fields of the same names. */
export function taskFrom(body: unknown, templates: IncomingTemplates) {
  const pick = (f: (typeof FIELDS)[number]) => (templates[f] !== undefined ? render(templates[f]!, body) : asText(at(body, f)));
  const due = pick("dueDate").trim();
  const priority = Number(at(body, "priority"));
  return {
    title: pick("title").trim().slice(0, 300),
    description: pick("description").trim().slice(0, 20000),
    // A date, or a date and time (its day).
    dueDate: /^\d{4}-\d{2}-\d{2}/.test(due) ? due.slice(0, 10) : null,
    priority: Number.isInteger(priority) && priority >= 1 && priority <= 4 ? priority : null,
    externalId: pick("externalId").trim().slice(0, 300) || null,
  };
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** The secret in a header, or a signature of the raw body made with it. */
export function authorized(secret: string, body: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
  const h = (name: string) => (typeof headers[name] === "string" ? (headers[name] as string) : "");
  const token = h("x-taskspipes-token") || h("authorization").replace(/^Bearer\s+/i, "");
  if (token && safeEqual(token, secret)) return true;
  const signature = h("x-taskspipes-signature");
  if (!signature) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  return safeEqual(signature, expected);
}

/** Creates the task an incoming webhook asks for. The answer and its status. */
export async function receive(
  integ: { id: string; pipe_id: string; secret: string; settings: { templates?: IncomingTemplates } | null; created_by: string | null },
  raw: Buffer,
  headers: Record<string, string | string[] | undefined>
): Promise<{ status: number; body: object }> {
  if (!authorized(decrypt(integ.secret)!, raw, headers)) return { status: 401, body: { error: "Invalid secret or signature" } };
  // Many tasks quickly is a loop on the other side: at most a few a minute per webhook.
  await enforceLimit({ name: "incoming-tasks", max: 60, timeWindow: 60_000 }, integ.id);

  let body: unknown;
  const text = raw.toString("utf8");
  try {
    body = String(headers["content-type"] ?? "").includes("form") ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text);
  } catch {
    return { status: 400, body: { error: "The body is neither JSON nor a form" } };
  }
  const t = taskFrom(body, integ.settings?.templates ?? {});
  if (!t.title) return { status: 400, body: { error: "No title: send a title, or set the webhook's title template" } };

  const author = integ.created_by
    ? await one(`SELECT id, name, locale FROM users WHERE id = $1 AND disabled_at IS NULL`, [integ.created_by])
    : null;
  if (!author) return { status: 403, body: { error: "The person who set up this webhook can no longer create tasks" } };

  if (t.externalId) {
    const seen = await one(
      `SELECT i.task_id, t.number FROM incoming_items i JOIN tasks t ON t.id = i.task_id WHERE i.integration_id = $1 AND i.external_id = $2`,
      [integ.id, t.externalId]
    );
    if (seen) return { status: 200, body: { ok: true, duplicate: true, task: present(seen.task_id, seen.number) } };
  }

  let id: string;
  try {
    id = await createTask(author.id, author.name, {
      pipeId: integ.pipe_id, title: t.title, description: t.description, dueDate: t.dueDate, priority: t.priority,
      // In the history, in the language of its author.
      comment: tr((author.locale as Locale) ?? config.defaultLocale, "Created by an incoming webhook"),
    });
  } catch (err) {
    // The author lost their rights on the pipe, the pipe is archived…: said to the other side.
    if (err instanceof HttpError) return { status: err.statusCode === 404 ? 403 : err.statusCode, body: { error: err.message } };
    throw err;
  }
  if (t.externalId) {
    await query(`INSERT INTO incoming_items (integration_id, external_id, task_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
      integ.id, t.externalId, id,
    ]);
  }
  const row = await one(`SELECT number FROM tasks WHERE id = $1`, [id]);
  return { status: 201, body: { ok: true, task: present(id, row!.number) } };
}

const present = (id: string, number: number) => ({ id, number, url: `${config.appUrl}/?task=${id}` });
