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
import { HttpError } from "./errors.js";
import { OutlineError } from "./outline.js";

const app = Fastify({
  trustProxy: true,
  bodyLimit: 1024 * 1024,
  logger: {
    level: config.logLevel,
    redact: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"],
    ...(config.prettyLogs ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } } } : {}),
  },
});

app.setErrorHandler((err: FastifyError, req, reply) => {
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
  if (err instanceof OutlineError) {
    req.log.warn({ err }, "Outline API error");
    return reply.code(err.status === 401 || err.status === 403 ? err.status : 502).send({ error: `Outline : ${err.message}` });
  }
  if ((err as { code?: string }).code === "22P02") return reply.code(400).send({ error: "Paramètre invalide" });
  if (err.validation || (err.statusCode && err.statusCode < 500)) {
    return reply.code(err.statusCode || 400).send({ error: err.message });
  }
  req.log.error({ err }, "Unhandled error");
  return reply.code(500).send({ error: "Erreur interne" });
});

await app.register(cookie);
await app.register(authPlugin);
await app.register(realtime);
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
app.log.info({ outline: config.outlineUrl, oauth: config.oauthEnabled }, "TasksPipes ready");
