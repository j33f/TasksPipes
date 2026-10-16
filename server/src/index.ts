import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { migrate, pool } from "./db.js";
import { authPlugin, cleanupSessions } from "./auth.js";
import { apiRoutes } from "./routes.js";
import { realtime } from "./realtime.js";
import { calendarRoutes } from "./calendar.js";
import { HttpError } from "./errors.js";
import { OutlineError } from "./outline.js";
import { localeOf, tr } from "./i18n.js";

const app = Fastify({
  trustProxy: true,
  bodyLimit: 1024 * 1024,
  logger: {
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
});

app.setErrorHandler((err: FastifyError, req, reply) => {
  // Messages are English source text, translated into the language of the page.
  const lang = localeOf(req);
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

await app.register(cookie);
await app.register(authPlugin);
await app.register(realtime);
await app.register(calendarRoutes);
await app.register(apiRoutes, { prefix: "/api" });

app.get("/healthz", async () => {
  await pool.query("SELECT 1");
  return { ok: true };
});

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

await migrate(app.log);
setInterval(() => cleanupSessions().catch((err) => app.log.warn({ err }, "Session cleanup failed")), 3_600_000).unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "Shutting down");
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: "0.0.0.0" });
app.log.info({ version: config.version, outline: config.outlineUrl, oauth: config.oauthEnabled }, "TasksPipes ready");
