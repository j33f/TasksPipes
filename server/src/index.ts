import { config } from "./config.js";
import { migrate, pool } from "./db.js";
import { cleanupSessions } from "./auth.js";
import { buildApp } from "./app.js";

const app = await buildApp();

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
