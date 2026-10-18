import { config } from "./config.js";
import { migrate, pool } from "./db.js";
import { cleanupSessions, disableUnusedInvitations } from "./auth.js";
import { buildApp } from "./app.js";
import { mailEnabled } from "./mail.js";
import { runScheduledReports } from "./reports.js";
import { cleanupNotifications, runNotifications } from "./notifications.js";

const app = await buildApp();

await migrate(app.log);
// Invitations never used are disabled once their link expired: at start, then every hour.
const disableUnused = () =>
  disableUnusedInvitations()
    .then((n) => n && app.log.info({ disabled: n }, "Unused invitations disabled"))
    .catch((err) => app.log.warn({ err }, "Disabling unused invitations failed"));
await disableUnused();
setInterval(() => {
  cleanupSessions().catch((err) => app.log.warn({ err }, "Session cleanup failed"));
  disableUnused();
  cleanupNotifications().catch((err) => app.log.warn({ err }, "Notification cleanup failed"));
}, 3_600_000).unref();

// Reports and notifications by e-mail: checked every minute, each one sent once.
if (mailEnabled) {
  setInterval(() => {
    runScheduledReports()
      .then((n) => n && app.log.info({ sent: n }, "Reports sent"))
      .catch((err) => app.log.error({ err }, "Report sending failed"));
    // E-mail notifications: immediate ones, the daily digest and the morning reminders of due dates.
    runNotifications()
      .then((n) => n && app.log.info({ sent: n }, "Notifications sent"))
      .catch((err) => app.log.error({ err }, "Notification sending failed"));
  }, 60_000).unref();
}

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
