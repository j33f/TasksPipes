import { runAiReplies } from "./ai-replies.js";
import { config } from "./config.js";
import { loadSettings, migrate, pool } from "./db.js";
import { SETTINGS_REFRESH_MS } from "./settings.js";
import { checkOutlineSessions, cleanupSessions, disableUnusedInvitations } from "./auth.js";
import { buildApp } from "./app.js";
import { mailEnabled } from "./mail.js";
import { cleanupReportRuns, runScheduledReports } from "./reports.js";
import { refreshIdleOutlineConnections, runScheduledOutlineExports } from "./outline-reports.js";
import { cleanupNotifications, runNotifications, runPush } from "./notifications.js";
import { cleanupInbox } from "./inbox.js";
import { cleanupOAuth } from "./oauth.js";
import { cleanupWebhookDeliveries, runWebhooks } from "./webhooks.js";
import { runRecurrences } from "./recurrence.js";
import { commentTask, recordOccurrence } from "./routes.js";
import { checkForUpdate } from "./updates.js";
import { checkBackups } from "./backups.js";

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
  cleanupInbox().catch((err) => app.log.warn({ err }, "In-app notification cleanup failed"));
  cleanupOAuth().catch((err) => app.log.warn({ err }, "OAuth cleanup failed"));
  cleanupWebhookDeliveries().catch((err) => app.log.warn({ err }, "Webhook delivery cleanup failed"));
  cleanupReportRuns().catch((err) => app.log.warn({ err }, "Report run cleanup failed"));
  // Outline accounts connected for a pipe's publishing (OAuth): kept alive when unused for a while.
  refreshIdleOutlineConnections()
    .then((failed) => {
      for (const f of failed) app.log.warn({ pipeId: f.pipeId, error: f.message }, "Outline connection of a pipe not renewed");
    })
    .catch((err) => app.log.warn({ err }, "Renewing Outline connections failed"));
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

// Backups made on the server (scripts/backup.sh): administrators are told when one fails or they stop coming.
const checkBackupState = () =>
  checkBackups()
    .then((p) => p && app.log.warn({ problem: p }, "Backup problem: administrators told"))
    .catch((err) => app.log.warn({ err }, "Checking the backups failed"));
setTimeout(checkBackupState, 120_000).unref();
setInterval(checkBackupState, 3_600_000).unref();

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

// The instance's AI answers for the agents of those who chose it (ai-replies.ts): every 10 seconds, one pass at a time.
let replying = false;
setInterval(() => {
  if (replying) return;
  replying = true;
  runAiReplies(commentTask, app.log)
    .then((n) => n && app.log.info({ written: n }, "AI replies written"))
    .catch((err) => app.log.error({ err }, "AI replies failed"))
    .finally(() => (replying = false));
}, 10_000).unref();

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

// Reports published to Outline, for the pipes that ask for it (independent of e-mail). A pass can outlast the
// minute when Outline is slow: the next one waits.
let publishingToOutline = false;
setInterval(() => {
  if (publishingToOutline) return;
  publishingToOutline = true;
  runScheduledOutlineExports()
    .then(({ published, failed }) => {
      if (published) app.log.info({ published }, "Reports published to Outline");
      for (const f of failed) app.log.warn({ pipeId: f.pipeId, error: f.message }, "Report not published to Outline");
    })
    .catch((err) => app.log.error({ err }, "Report publishing to Outline failed"))
    .finally(() => (publishingToOutline = false));
}, 60_000).unref();

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

await app.listen({ port: config.port, host: config.host });
app.log.info({ version: config.version, outline: config.outlineUrl, oauth: config.oauthEnabled }, "TasksPipes ready");
