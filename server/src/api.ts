/**
 * The public API: personal access tokens, and /api/v1 — a documented, versioned subset of the app's API (OpenAPI at
 * /api/v1/openapi.json, Swagger UI at /api/v1/docs). A token acts with exactly the rights of its owner, through the
 * same routes and checks as the app; a read token only reads. Tokens are accepted on /api/v1 only.
 */
import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest, RouteOptions } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { config } from "./config.js";
import { one, query } from "./db.js";
import { HttpError, bad, forbidden, notFound } from "./errors.js";
import { LIMITS, enforceLimit, rateLimited } from "./rate-limit.js";

export const V1 = "/api/v1";
const TOKEN = /^tp_[A-Za-z0-9_-]{43}$/;
export const MAX_TOKEN_DAYS = 366;
const hash = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

export interface ApiToken {
  id: string;
  scope: "read" | "write";
}

declare module "fastify" {
  interface FastifyRequest {
    /** The access token the request came with (public API), if any. */
    apiToken: ApiToken | null;
    /** A token was given but is unknown, expired, revoked, or its account disabled. */
    apiTokenRefused: boolean;
  }
}

/** The account and scope of a bearer token, or null. Last use is recorded at most once a minute. */
export async function tokenUser(header: string | undefined) {
  const m = String(header ?? "").match(/^Bearer\s+(\S+)$/i);
  if (!m || !TOKEN.test(m[1])) return m ? null : undefined;
  const row = await one(
    `UPDATE api_tokens t SET last_used_at = CASE WHEN t.last_used_at > now() - interval '1 minute' THEN t.last_used_at ELSE now() END
     FROM users u
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now() AND u.id = t.user_id AND u.disabled_at IS NULL
     RETURNING t.id, t.scope, u.id AS user_id, u.name, u.email, u.avatar_url, u.auth_kind, u.totp_secret IS NOT NULL AS totp, u.locale, u.theme`,
    [hash(m[1])]
  );
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Documentation of the /api/v1 routes: those not listed here answer 404 there.

const uuid = { type: "string", format: "uuid" } as const;
const idParams = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const object = (description: string, properties: Record<string, unknown> = {}) =>
  ({ description, type: "object", additionalProperties: true, properties }) as const;
const list = (description: string) => ({ description, type: "array", items: { type: "object", additionalProperties: true } }) as const;
const ok = object("Done", { ok: { type: "boolean" } });
const task = object("A task", {
  id: uuid, number: { type: "integer" }, title: { type: "string" }, description: { type: "string" },
  status: { type: "string" }, stage: { type: "string", nullable: true }, taskType: { type: "string" },
  fields: { type: "object", additionalProperties: true }, dueDate: { type: "string", format: "date", nullable: true },
});
const taskBody = {
  title: { type: "string", maxLength: 300 },
  description: { type: "string" },
  stage: { type: "string", description: "Column id of the pipe type" },
  dueDate: { type: "string", format: "date", nullable: true },
  assigneeId: { ...uuid, nullable: true, description: "Owner, a member of a team space" },
  taskType: { type: "string" },
  fields: { type: "object", additionalProperties: true, description: "Values by field id of the task type" },
  priority: { type: "integer", minimum: 1, maximum: 4, nullable: true, description: "1 urgent, 2 high, 3 medium, 4 low; null for none" },
  labelIds: { type: "array", items: uuid, description: "Labels of the task's space (all of them: the others are taken off)" },
  estimateMinutes: { type: "integer", minimum: 1, maximum: 60000, nullable: true, description: "Estimate, in minutes; null for none" },
} as const;

interface Doc {
  tag: string;
  summary: string;
  params?: object;
  querystring?: object;
  body?: object;
  response: object;
}

export const V1_ROUTES: Record<string, Doc> = {
  "GET /me": { tag: "Account", summary: "The account of the token", response: object("Account, personal space and features") },
  "GET /users": { tag: "People", summary: "People one can see", response: list("People") },
  "GET /spaces": { tag: "Spaces", summary: "Spaces one can reach: personal spaces and teams", response: list("Spaces") },
  "GET /spaces/:id": { tag: "Spaces", summary: "A space, its members, pipes and incoming", params: idParams, response: object("Space") },
  "GET /pipes/:id": { tag: "Pipes", summary: "A pipe and its tasks", params: idParams, response: object("Pipe with its tasks") },
  "GET /spaces/:id/labels": { tag: "Labels", summary: "The labels of a space", params: idParams, response: list("Labels") },
  "POST /spaces/:id/labels": {
    tag: "Labels", summary: "Create a label in a space one is a member of", params: idParams,
    body: { type: "object", required: ["name", "color"], properties: { name: { type: "string", maxLength: 40 }, color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" } } },
    response: object("The label", { id: uuid }),
  },
  "PATCH /labels/:id": {
    tag: "Labels", summary: "Rename, recolor or move a label", params: idParams,
    body: { type: "object", properties: { name: { type: "string", maxLength: 40 }, color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }, position: { type: "number" } } },
    response: object("The label"),
  },
  "DELETE /labels/:id": { tag: "Labels", summary: "Delete a label (it is taken off its tasks)", params: idParams, response: ok },
  "GET /calendar": {
    tag: "Tasks", summary: "Tasks due in a period (62 days at most), in the pipes one sees",
    querystring: { type: "object", required: ["from", "to"], properties: {
      from: { type: "string", format: "date" }, to: { type: "string", format: "date" },
      scope: { type: "string", enum: ["mine", "all"], description: "One's own tasks (default), or all those one sees" },
      space: uuid, done: { type: "string", enum: ["0", "1"], description: "1 to include finished tasks" },
    } },
    response: object("Tasks, with canMove when one may change their due date", { truncated: { type: "boolean" } }),
  },
  "GET /me/tasks": { tag: "Tasks", summary: "Tasks one owns, still to do", response: list("Tasks") },
  "GET /search": {
    tag: "Tasks", summary: "Search the tasks one can see",
    querystring: { type: "object", required: ["q"], properties: {
      q: { type: "string" }, status: { type: "string", description: "A status, or \"open\"" }, owner: uuid, type: { type: "string" },
      label: { type: "string", description: "A label name" }, priority: { type: "integer", minimum: 0, maximum: 4, description: "0 for none" },
    } },
    response: list("Found tasks, best first"),
  },
  "POST /tasks": {
    tag: "Tasks", summary: "Create a task in a pipe (pipeId) or send it to a space's incoming (spaceId)",
    body: { type: "object", required: ["title"], properties: { ...taskBody, pipeId: uuid, spaceId: uuid, comment: { type: "string" },
      items: { type: "array", items: { type: "string" } } } },
    response: object("The new task", { id: uuid }),
  },
  "GET /tasks/:id": { tag: "Tasks", summary: "A task, with its history, sub-tasks and files", params: idParams, response: task },
  "PATCH /tasks/:id": {
    tag: "Tasks", summary: "Change a task", params: idParams,
    body: { type: "object", properties: taskBody }, response: task,
  },
  "POST /tasks/:id/move": {
    tag: "Tasks", summary: "Move a task to a pipe of its space", params: idParams,
    body: { type: "object", required: ["pipeId"], properties: {
      pipeId: uuid, stage: { type: "string" }, taskType: { type: "string", description: "A task type the target pipe offers, to change it on the way" },
    } }, response: ok,
  },
  "POST /tasks/:id/send": {
    tag: "Tasks", summary: "Send a task to a space's incoming", params: idParams,
    body: { type: "object", required: ["spaceId"], properties: { spaceId: uuid, assigneeId: uuid, comment: { type: "string" } } }, response: ok,
  },
  "POST /tasks/:id/comments": {
    tag: "Tasks", summary: "Comment on a task", params: idParams,
    body: { type: "object", required: ["body"], properties: { body: { type: "string" } } }, response: ok,
  },
  "POST /tasks/:id/dependencies": {
    tag: "Tasks", summary: "Make a task wait for another one (blockerId), until it is done or abandoned", params: idParams,
    body: { type: "object", required: ["blockerId"], properties: { blockerId: uuid } },
    response: object("The tasks it waits for (blockedBy) and those waiting for it (blocks)"),
  },
  "DELETE /tasks/:id/dependencies/:blockerId": {
    tag: "Tasks", summary: "Stop a task waiting for another one",
    params: { type: "object", required: ["id", "blockerId"], properties: { id: uuid, blockerId: uuid } },
    response: object("The tasks it waits for (blockedBy) and those waiting for it (blocks)"),
  },
  "GET /tasks/:id/time": { tag: "Time", summary: "Time logged on a task", params: idParams, response: object("Entries and total", { totalMinutes: { type: "integer" } }) },
  "POST /tasks/:id/time": {
    tag: "Time", summary: "Log one's own time on a task (today, or a day of the last 90 days)", params: idParams,
    body: { type: "object", required: ["minutes"], properties: {
      minutes: { type: "integer", minimum: 1, maximum: 1440 }, spentOn: { type: "string", format: "date" }, note: { type: "string", maxLength: 500 },
    } },
    response: object("The entry", { id: uuid }),
  },
  "PATCH /time/:id": {
    tag: "Time", summary: "Change one's own time entry", params: idParams,
    body: { type: "object", properties: {
      minutes: { type: "integer", minimum: 1, maximum: 1440 }, spentOn: { type: "string", format: "date" }, note: { type: "string", maxLength: 500 },
    } },
    response: object("The entry"),
  },
  "DELETE /time/:id": { tag: "Time", summary: "Delete a time entry (one's own, or any as an admin of the task's team)", params: idParams, response: ok },
  "POST /tasks/:id/items": {
    tag: "Sub-tasks", summary: "Add a sub-task", params: idParams,
    body: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 500 } } }, response: object("The sub-task", { id: uuid }),
  },
  "PATCH /items/:id": {
    tag: "Sub-tasks", summary: "Change or check a sub-task", params: idParams,
    body: { type: "object", properties: { text: { type: "string" }, done: { type: "boolean" } } }, response: ok,
  },
  "DELETE /items/:id": { tag: "Sub-tasks", summary: "Delete a sub-task", params: idParams, response: ok },
};

const hidden: RouteOptions["handler"] = async () => {
  throw notFound("Not found");
};

/** The TasksPipes mark on the docs' dark top bar (docs/logo-dark.svg) and as their favicon (web/public/favicon.svg). */
const DOCS_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="32" viewBox="0 0 196 32"><rect width="32" height="32" rx="8" fill="#fff"/><rect x="7" y="8" width="5" height="16" rx="2" fill="#111319"/><rect x="14" y="8" width="5" height="11" rx="2" fill="#111319" opacity=".75"/><rect x="21" y="8" width="5" height="7" rx="2" fill="#111319" opacity=".5"/><text x="42" y="23" font-family="Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="22" font-weight="600" fill="#fff">TasksPipes</text></svg>`;
const DOCS_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#111319"/><rect x="7" y="8" width="5" height="16" rx="2" fill="#fff"/><rect x="14" y="8" width="5" height="11" rx="2" fill="#fff" opacity=".75"/><rect x="21" y="8" width="5" height="7" rx="2" fill="#fff" opacity=".5"/></svg>`;

/** Swagger first (it records the routes registered after it), then /api/v1, built from the app's own routes. */
export async function publicApi(app: FastifyInstance, apiRoutes: (app: FastifyInstance) => Promise<void>) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "TasksPipes API",
        version: config.version,
        description: "Every request acts with the rights of the token's owner. Create tokens in Settings › Access tokens.",
      },
      servers: [{ url: config.appUrl }],
      components: { securitySchemes: { token: { type: "http", scheme: "bearer", description: "A personal access token (tp_…)" } } },
      security: [{ token: [] }],
    },
    hideUntagged: true,
  });
  await app.register(swaggerUi, {
    routePrefix: `${V1}/docs`,
    logo: { type: "image/svg+xml", content: DOCS_LOGO, href: config.appUrl, target: "_self" },
    theme: {
      title: "TasksPipes API",
      favicon: [{ filename: "favicon.svg", rel: "icon", type: "image/svg+xml", sizes: "any", content: DOCS_FAVICON }],
    },
  });
  app.get(`${V1}/openapi.json`, { schema: { hide: true } }, async () => app.swagger());

  await app.register(async (v1) => {
    v1.addHook("onRoute", (route) => {
      const doc = V1_ROUTES[`${route.method} ${route.url.slice(V1.length)}`];
      if (!doc) {
        route.handler = hidden;
        route.schema = { hide: true };
        return;
      }
      route.schema = {
        ...route.schema, tags: [doc.tag], summary: doc.summary,
        ...(doc.params ? { params: doc.params } : {}), ...(doc.querystring ? { querystring: doc.querystring } : {}),
        ...(doc.body ? { body: doc.body } : {}), response: { 200: doc.response },
      };
    });
    v1.addHook("onRequest", async (req) => {
      if (req.apiTokenRefused) {
        await enforceLimit(LIMITS.api, `refused:${req.ip}`);
        throw new HttpError(401, "This access token is invalid, expired or revoked");
      }
      await enforceLimit(LIMITS.api, req.apiToken?.id ?? req.user?.id ?? req.ip);
      if (req.apiToken?.scope === "read" && req.method !== "GET" && req.method !== "HEAD") throw forbidden("This access token can only read");
    });
    await v1.register(apiRoutes);
  }, { prefix: V1 });
}

// ---------------------------------------------------------------------------
// Managing one's tokens (with a session only: under /api, where tokens are not accepted)

export async function tokenRoutes(app: FastifyInstance) {
  app.get("/me/tokens", async (req: FastifyRequest) => {
    const { rows } = await query(
      `SELECT id, name, prefix, scope, expires_at, last_used_at, created_at FROM api_tokens
       WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [req.user!.id]
    );
    return rows.map((t) => ({
      id: t.id, name: t.name, prefix: t.prefix, scope: t.scope, expiresAt: t.expires_at, lastUsedAt: t.last_used_at, createdAt: t.created_at,
      expired: new Date(t.expires_at) <= new Date(),
    }));
  });

  // The token is in this answer only: what is kept is its hash.
  app.post<{ Body: { name?: string; scope?: string; days?: number } }>("/me/tokens", rateLimited(LIMITS.apiTokens), async (req) => {
    const name = String(req.body?.name ?? "").trim().slice(0, 100);
    if (!name) throw bad("{label} is required", { label: "Name" });
    const scope = req.body?.scope === "write" ? "write" : req.body?.scope === "read" ? "read" : null;
    if (!scope) throw bad("Choose what the token may do");
    const days = Number(req.body?.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_TOKEN_DAYS) throw bad("A token expires within {n} days", { n: MAX_TOKEN_DAYS });
    const token = `tp_${crypto.randomBytes(32).toString("base64url")}`;
    const row = await one(
      `INSERT INTO api_tokens (user_id, name, token_hash, prefix, scope, expires_at) VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
       RETURNING id, expires_at`,
      [req.user!.id, name, hash(token), token.slice(0, 10), scope, days]
    );
    req.log.info({ tokenId: row!.id, scope }, "Access token created");
    return { id: row!.id, token, expiresAt: row!.expires_at };
  });

  app.delete<{ Params: { id: string } }>("/me/tokens/:id", async (req) => {
    const r = await query(`UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [
      /^[0-9a-f-]{36}$/i.test(req.params.id) ? req.params.id : "00000000-0000-0000-0000-000000000000",
      req.user!.id,
    ]);
    if (!r.rowCount) throw notFound("Not found");
    return { ok: true };
  });
}
