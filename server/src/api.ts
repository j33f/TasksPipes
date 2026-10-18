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
  "GET /me/tasks": { tag: "Tasks", summary: "Tasks one owns, still to do", response: list("Tasks") },
  "GET /search": {
    tag: "Tasks", summary: "Search the tasks one can see",
    querystring: { type: "object", required: ["q"], properties: {
      q: { type: "string" }, status: { type: "string", description: "A status, or \"open\"" }, owner: uuid, type: { type: "string" },
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
  await app.register(swaggerUi, { routePrefix: `${V1}/docs` });
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
