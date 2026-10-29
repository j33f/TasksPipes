/** The Fastify application, without starting it (index.ts starts it; tests drive it directly). */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import Fastify, { type FastifyError, type FastifyHttpOptions } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { pool } from "./db.js";
import { authPlugin, loginError } from "./auth.js";
import { oidcRoutes } from "./oidc.js";
import { apiRoutes, gitWebhooks } from "./routes.js";
import { publicApi } from "./api.js";
import { realtime } from "./realtime.js";
import { calendarRoutes } from "./calendar.js";
import { deletionLinkRoutes } from "./account.js";
import { notificationRoutes } from "./notifications.js";
import { rateLimited, rateLimits } from "./rate-limit.js";
import { HttpError } from "./errors.js";
import { OutlineError } from "./outline.js";
import { localeOf, tr } from "./i18n.js";

export interface AppOptions {
  /** Request logging (off in tests). */
  logger?: boolean;
  /** Serve the built web app and its fallback (off in tests: the API is enough). */
  web?: boolean;
}

export async function buildApp({ logger = true, web = true }: AppOptions = {}) {
  const options: FastifyHttpOptions<Server> = {
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    logger: logger && {
      level: config.logLevel,
      redact: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"],
      serializers: {
        // Calendar feed URLs carry their secret token: keep it out of the logs.
        req: (req) => ({
          method: req.method,
          url: req.url.replace(/^\/cal\/[^/?]+/, "/cal/***"),
          remoteAddress: req.ip,
        }),
      },
      ...(config.prettyLogs ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } } } : {}),
    },
  };
  const app = Fastify(options);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    // Messages are English source text, translated into the language of the page.
    const lang = localeOf(req);
    // Sign-in pages the browser was sent to (a provider, its return): back on the sign-in page, never a raw error.
    if (req.method === "GET" && req.url.startsWith("/auth/")) {
      if (!(err instanceof HttpError)) req.log.error({ err }, "Sign-in error");
      return loginError(reply, err instanceof HttpError ? tr(lang, err.message, err.params) : tr(lang, "Sign-in failed"));
    }
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: tr(lang, err.message, err.params) });
    if (err instanceof OutlineError) {
      req.log.warn({ err }, "Outline API error");
      return reply
        .code(err.status === 401 || err.status === 403 ? err.status : 502)
        .send({ error: tr(lang, "Outline: {message}", { message: tr(lang, err.message, err.params) }) });
    }
    if ((err as { code?: string }).code === "22P02") return reply.code(400).send({ error: tr(lang, "Invalid parameter") });
    if (err.statusCode === 413) return reply.code(413).send({ error: tr(lang, "File too large") });
    if (err.validation || (err.statusCode && err.statusCode < 500)) {
      return reply.code(err.statusCode || 400).send({ error: err.message });
    }
    req.log.error({ err }, "Unhandled error");
    return reply.code(500).send({ error: tr(lang, "Internal error") });
  });

  // Every API answer carries the server's version: an open page built for another version reloads itself.
  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/api/")) reply.header("X-App-Version", config.version);
  });

  // Before the routes: it limits those that ask for it.
  await rateLimits(app);
  await app.register(cookie);
  await app.register(authPlugin);
  await app.register(oidcRoutes);
  await app.register(realtime);
  await app.register(calendarRoutes);
  await app.register(notificationRoutes);
  await app.register(deletionLinkRoutes);
  // The public API (/api/v1, documented, with access tokens) is made of the same routes as the app.
  await publicApi(app, apiRoutes);
  await app.register(apiRoutes, { prefix: "/api" });
  await app.register(gitWebhooks);

  // Container health checks call it every 30 s; it reaches the database, so it is limited too.
  app.get("/healthz", rateLimited({ name: "healthz", max: 120, timeWindow: 60_000 }), async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  });

  if (web) {
    const webDir = config.webDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
    await app.register(fastifyStatic, { root: webDir, index: false });

    // SPA fallback: the root and every unknown GET outside /api serve the front-end.
    app.get("/", (_req, reply) => reply.header("Cache-Control", "no-cache").sendFile("index.html"));
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) {
        return reply.header("Cache-Control", "no-cache").sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  }

  return app;
}
