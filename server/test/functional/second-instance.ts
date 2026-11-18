/**
 * A second instance of the app, in its own process, on the same database: for multi-instance.test.ts.
 * Prints its port once it listens; stops on SIGTERM.
 */
import { buildApp } from "../../src/app.js";
import { migrate, pool } from "../../src/db.js";

const app = await buildApp({ logger: false, web: false });
await migrate(app.log);
await app.listen({ port: 0, host: "127.0.0.1" });
process.stdout.write(`${(app.server.address() as { port: number }).port}\n`);

process.once("SIGTERM", async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});
