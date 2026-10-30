import { config } from "./config.js";
import { loadSettings, migrate, pool } from "./db.js";
import { SETTINGS_REFRESH_MS } from "./settings.js";
import { checkOutlineSessions, cleanupSessions, disableUnusedInvitations } from "./auth.js";
import { buildApp } from "./app.js";
import { mailEnabled } from "./mail.js";
import { runScheduledReports } from "./reports.js";
import { cleanupNotifications, runNotifications, runPush } from "./notifications.js";
import { cleanupWebhookDeliveries, runWebhooks } from "./webhooks.js";
import { runRecurrences } from "./recurrence.js";
import { recordOccurrence } from "./routes.js";
import { checkForUpdate } from "./updates.js";

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
  cleanupWebhookDeliveries().catch((err) => app.log.warn({ err }, "Webhook delivery cleanup failed"));
  // Outline accounts whose access was revoked or suspended in Outline lose their sessions.
  checkOutlineSessions()
    .then((n) => n && app.log.info({ closed: n }, "Sessions closed: Outline access ended"))
    .catch((err) => app.log.warn({ err }, "Checking Outline sessions failed"));
}, 3_600_000).unref();

// New versions of TasksPipes: a minute after start, then every hour.
const checkUpdates = () =>
  checkForUpdate()
    .then((v) => v && app.log.info({ version: v }, "New version available: administrators told"))
    .catch((err) => app.log.warn({ err }, "Checking for a new version failed"));
setTimeout(checkUpdates, 60_000).unref();
setInterval(checkUpdates, 3_600_000).unref();

// Recurring tasks: the occurrences due, every minute (each made once, whatever the number of instances).
setInterval(() => {
  runRecurrences(recordOccurrence)
    .then((n) => n && app.log.info({ made: n }, "Recurring tasks made"))
    .catch((err) => app.log.error({ err }, "Making recurring tasks failed"));
}, 60_000).unref();

// Outgoing webhooks: deliveries due, every 15 seconds.
let sendingWebhooks = false;
setInterval(() => {
  if (sendingWebhooks) return;
  sendingWebhooks = true;
  runWebhooks()
    .catch((err) => app.log.error({ err }, "Webhook sending failed"))
    .finally(() => (sendingWebhooks = false));
}, 15_000).unref();

// Settings changed in the administration on another instance.
setInterval(() => {
  loadSettings().catch((err) => app.log.warn({ err }, "Reloading the settings failed"));
}, SETTINGS_REFRESH_MS).unref();

// Push notifications to devices: every 15 seconds, each one pushed once.
let pushing = false;
setInterval(() => {
  if (pushing) return;
  pushing = true;
  runPush()
    .catch((err) => app.log.error({ err }, "Push sending failed"))
    .finally(() => (pushing = false));
}, 15_000).unref();

// Reports and notifications by e-mail: checked every minute, each one sent once. E-mail can be set up while the
// server runs (Administration › Settings): each pass checks it.
setInterval(() => {
  if (!mailEnabled()) return;
  runScheduledReports()
    .then((n) => n && app.log.info({ sent: n }, "Reports sent"))
    .catch((err) => app.log.error({ err }, "Report sending failed"));
  // E-mail notifications: immediate ones, the daily digest and the morning reminders of due dates.
  runNotifications()
    .then((n) => n && app.log.info({ sent: n }, "Notifications sent"))
    .catch((err) => app.log.error({ err }, "Notification sending failed"));
}, 60_000).unref();

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
