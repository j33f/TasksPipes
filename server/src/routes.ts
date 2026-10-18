import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { loadCustomTypes, one, pool, query, syncStages, tx, type Queryable, type Row } from "./db.js";
import { absoluteOutlineUrl, type OutlineDocument } from "./outline.js";
import { HttpError, bad, forbidden, notFound } from "./errors.js";
import {
  DEFAULT_PIPE_TYPE, allPipeTypes, allTaskTypes, pipeTypeById, resolveStage, stageLabel, taskTypeById, usableBy, type TaskType,
} from "./pipeTypes.js";
import { validatePipeType, validateTaskType } from "./designer.js";
import { exportModels, importModels } from "./models-io.js";
import { latestReportDay, latestReportWeek, pipeDailyReport, pipeWeeklyReport, reportDay, stepTimes } from "./reports.js";
import { lastWeekday } from "./time.js";
import { PROVIDERS, TASK_KEY_PREFIX, gitItems, verifyGithub, verifyGitlab, type GitItem, type Provider } from "./git.js";
import crypto from "node:crypto";
import { cleanFields } from "./fields.js";
import { LOCALES, localeOf, localize, localizePipeType, localizeTaskType, tr, type Locale } from "./i18n.js";
import QRCode from "qrcode";
import { INVITE_LINK_HOURS, createLoginLink, decrypt, encrypt, ensurePersonalSpace, reenableInvited } from "./auth.js";
import { newSecret, otpauthUrl, verifyTotp } from "./totp.js";
import { isEmail, sendLinkMail, sendOutlineInvite } from "./mail.js";
import { notifySpace, notifyUser } from "./realtime.js";
import { calendarUrl } from "./calendar.js";
import { adminRoutes, requestIsAdmin } from "./admin.js";
import { accountRoutes } from "./account.js";
import { tokenRoutes } from "./api.js";
import { queueWebhooks, webhookRoutes } from "./webhooks.js";
import { presentRecurrence, recurrenceRoutes, type RecordCreated } from "./recurrence.js";
import { LIMITS, perPerson, rateLimited } from "./rate-limit.js";
import { cleanPrefs, notificationState, prefsOf, queueNotifications, savePrefs } from "./notifications.js";
import { searchTasks } from "./search.js";
import { columnsFor, csvRows, exportCsv, exportJson, planImport, targetsFor, taskTypesOf, trelloRows, TRELLO_MAPPING, type ExportedTask, type Person, type Target } from "./pipe-io.js";
import { SPACE_NAME, TASK_SELECT, getTaskRow, memberRole, spaceVisible, taskPermissions, type TaskPermissions } from "./access.js";

export const STATUSES = ["backlog", "ready", "started", "ongoing", "blocked", "abandoned", "done"] as const;
type Status = (typeof STATUSES)[number];
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
type Req = FastifyRequest<{ Params: Record<string, string>; Body: Body; Querystring: Record<string, string> }>;

// ---------------------------------------------------------------------------
// Input helpers

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw bad("{label} is invalid", { label });
  return value;
}
const optUuid = (value: unknown, label: string) =>
  value === null || value === undefined || value === "" ? null : uuid(value, label);

function text(value: unknown, label: string, { required = false, max = 100_000 } = {}): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (required && !v) throw bad("{label} is required", { label });
  if (v.length > max) throw bad("{label} is too long", { label });
  return v;
}

function dateOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad("Invalid due date");
  return value;
}

function status(value: unknown, fallback: Status = "backlog"): Status {
  if (value === undefined || value === null) return fallback;
  if (!STATUSES.includes(value as Status)) throw bad("Invalid status");
  return value as Status;
}

interface DocRef {
  id: string;
  title: string;
  url: string | null;
}

function docOrNull(doc: unknown): DocRef | null {
  if (!doc) return null;
  const d = doc as Partial<DocRef>;
  if (typeof d.id !== "string" || !d.id) throw bad("Invalid Outline document");
  return {
    id: d.id.slice(0, 200),
    title: String(d.title || "Untitled").slice(0, 500),
    url: absoluteOutlineUrl(String(d.url || "")),
  };
}

const color = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 20) : null);
function taskType(value: unknown) {
  const t = taskTypeById(value === undefined || value === null || value === "" ? "task" : value);
  if (!t) throw bad("Invalid task type");
  return t;
}

const icon = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 32) : null);

/** A pipe type someone may choose (someone else's private type only if the pipe already has it). */
function pipeKind(value: unknown, userId: string, current?: string): string {
  if (value === undefined || value === null || value === "") return DEFAULT_PIPE_TYPE;
  const t = pipeTypeById(value);
  if (!t || (value !== current && !usableBy(t, userId))) throw bad("Invalid pipe type");
  return t.id;
}

/** Someone else's private task type is usable only where a pipe type offers it, or on a task that already has it. */
function assertTaskTypeUsable(type: TaskType, userId: string, pipeKindId: string | null, current?: string) {
  if (type.id === current || usableBy(type, userId) || pipeTypeById(pipeKindId)?.taskTypes.includes(type.id)) return;
  throw bad("Invalid task type");
}

// ---------------------------------------------------------------------------
// Data access helpers

function getSpace(id: string, userId: string) {
  return one(
    `SELECT s.id, s.kind, s.user_id, ${SPACE_NAME} AS name, s.description, s.color,
            su.avatar_url, s.created_at, m.role AS my_role
     FROM spaces s
     LEFT JOIN users su ON su.id = s.user_id
     LEFT JOIN space_members m ON m.space_id = s.id AND m.user_id = $2
     WHERE s.id = $1 AND space_visible($2, s.id)`,
    [id, userId]
  );
}

const personalSpaceId = async (userId: string, db?: Queryable): Promise<string> =>
  (await one(`SELECT id FROM spaces WHERE user_id = $1`, [userId], db))?.id;

export function presentTask(t: Row) {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    description: t.description,
    status: t.status,
    stage: t.stage,
    taskType: t.task_type,
    fields: t.fields,
    position: t.position,
    dueDate: t.due_date,
    space: { id: t.space_id, name: t.space_name, kind: t.space_kind },
    pipe: t.pipe_id ? { id: t.pipe_id, name: t.pipe_name, visibility: t.pipe_visibility, kind: t.pipe_kind } : null,
    inIncoming: !t.pipe_id,
    author: { id: t.author_id, name: t.author_name, avatarUrl: t.author_avatar },
    // In a personal space the task belongs to that person; elsewhere to its (optional) assignee.
    assignee: t.space_user_id
      ? { id: t.space_user_id, name: t.space_name, avatarUrl: t.space_user_avatar }
      : t.assignee_id
        ? { id: t.assignee_id, name: t.assignee_name, avatarUrl: t.assignee_avatar }
        : null,
    sender: t.sender_id ? { id: t.sender_id, name: t.sender_name, avatarUrl: t.sender_avatar } : null,
    outlineDoc: t.outline_doc_id ? { id: t.outline_doc_id, title: t.outline_doc_title, url: t.outline_doc_url } : null,
    commentCount: t.comment_count,
    // State of the latest pull/merge request naming the task.
    gitState: t.git_state ?? null,
    checklist: t.checklist ?? { total: 0, done: 0, next: null },
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

function presentPipe(p: Row) {
  return {
    id: p.id,
    spaceId: p.space_id,
    name: p.name,
    description: p.description,
    visibility: p.visibility,
    kind: p.kind,
    icon: p.icon,
    archived: Boolean(p.archived_at),
    isDefault: p.is_default,
    dailyReport: Boolean(p.daily_report),
    weeklyReport: Boolean(p.weekly_report),
    color: p.color,
    position: p.position,
    createdBy: p.created_by ? { id: p.created_by, name: p.created_by_name } : null,
    counts: p.counts || {},
    createdAt: p.created_at,
  };
}

/** Number of tasks per status of the pipe aliased `p`. */
const PIPE_COUNTS = `(SELECT json_object_agg(status, n) FROM
  (SELECT status, count(*) AS n FROM tasks t WHERE t.pipe_id = p.id GROUP BY status) c) AS counts`;

async function loadTaskFor(id: string, userId: string, need?: keyof TaskPermissions) {
  const t = await getTaskRow(uuid(id, "Task"));
  if (!t) throw notFound("Task not found");
  const perms = await taskPermissions(t, userId);
  if (!perms.view) throw notFound("Task not found");
  if (need && !perms[need]) throw forbidden();
  return { t, perms };
}

async function loadPipeFor(id: unknown, userId: string) {
  const p = await one(
    `SELECT p.*, u.name AS created_by_name FROM pipes p LEFT JOIN users u ON u.id = p.created_by WHERE p.id = $1`,
    [uuid(id, "Pipe")]
  );
  if (!p) throw notFound("Pipe not found");
  const role = await memberRole(p.space_id, userId);
  if (!role && (p.visibility !== "open" || !(await spaceVisible(p.space_id, userId)))) throw notFound("Pipe not found");
  return { p, role };
}

interface Snapshot {
  space_id: string;
  pipe_id: string | null;
  status: Status;
  /** Label of the board column, as shown at the time. */
  stage: string | null;
  assignee_id: string | null;
  due_date: string | null;
  doc: DocRef | null;
}

const snapshot = (t: Row): Snapshot => ({
  space_id: t.space_id,
  pipe_id: t.pipe_id,
  status: t.status,
  stage: stageLabel(t.pipe_kind, t.stage),
  assignee_id: t.space_user_id ?? t.assignee_id,
  due_date: t.due_date,
  doc: t.outline_doc_id ? { id: t.outline_doc_id, title: t.outline_doc_title, url: t.outline_doc_url } : null,
});

/** The history entry of a task made by a recurring series (recurrence.ts), as any creation. */
export const recordOccurrence: RecordCreated = async (db, taskId, actorId, recurrenceId) => {
  const row = await getTaskRow(taskId, db);
  await recordEvent(db, taskId, actorId, "created", null, snapshot(row!), null, { recurrence: recurrenceId });
};

/** Writes one entry of a task's history, with the state before and after the change, and queues its notifications. */
async function recordEvent(
  db: Queryable,
  taskId: string,
  actorId: string,
  type: string,
  before: Snapshot | null,
  after: Snapshot,
  comment: string | null = null,
  details: object | null = null,
  /** Off for imports: a whole file of tasks would otherwise e-mail everyone named in it. */
  notify = true
) {
  const { rows } = await db.query(
    `INSERT INTO task_events (task_id, actor_id, type, comment,
       from_space_id, to_space_id, from_pipe_id, to_pipe_id, from_status, to_status,
       from_assignee_id, to_assignee_id, from_due_date, to_due_date, from_doc, to_doc,
       from_stage, to_stage, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
    [
      taskId, actorId, type, comment || null,
      before?.space_id ?? null, after.space_id,
      before?.pipe_id ?? null, after.pipe_id,
      before?.status ?? null, after.status,
      before?.assignee_id ?? null, after.assignee_id,
      before?.due_date ?? null, after.due_date,
      before?.doc ? JSON.stringify(before.doc) : null,
      after.doc ? JSON.stringify(after.doc) : null,
      before?.stage ?? null, after.stage,
      details ? JSON.stringify(details) : null,
    ]
  );
  // E-mail notifications it causes, in the same transaction.
  if (notify) await queueNotifications(db, Number(rows[0].id));
  // Outgoing webhooks of the pipes concerned (imports too: integrations want every task).
  await queueWebhooks(db, Number(rows[0].id));
}

async function nextPosition(db: Queryable, spaceId: string, pipeId: string | null, stage: string | null): Promise<number> {
  const r = pipeId
    ? await one(`SELECT COALESCE(max(position), 0) + 1 AS p FROM tasks WHERE pipe_id = $1 AND stage = $2`, [pipeId, stage], db)
    : await one(`SELECT COALESCE(max(position), 0) + 1 AS p FROM tasks WHERE space_id = $1 AND pipe_id IS NULL`, [spaceId], db);
  return r!.p;
}

/** Catalog names recorded in an event's details (type, fields), shown in `lang`. */
function localizeDetails(lang: Locale, d: Row): Row {
  const l = (v: unknown) => (typeof v === "string" ? localize(lang, v) : v);
  return {
    ...d,
    ...(d.taskType ? { taskType: { from: l(d.taskType.from), to: l(d.taskType.to) } } : {}),
    ...(Array.isArray(d.fields) ? { fields: d.fields.map(l) } : {}),
    ...(d.field ? { field: l(d.field) } : {}),
  };
}

/** History of a task; column, type and field names recorded with it are shown in `lang`. */
export async function getEvents(taskId: string, lang: Locale) {
  const { rows } = await query(
    `SELECT e.*, a.name AS actor_name, a.avatar_url AS actor_avatar,
            COALESCE(fsu.name, fs.name) AS from_space_name, COALESCE(tsu.name, ts.name) AS to_space_name,
            fp.name AS from_pipe_name, tp.name AS to_pipe_name,
            fa.name AS from_assignee_name, ta.name AS to_assignee_name
     FROM task_events e
     JOIN users a ON a.id = e.actor_id
     LEFT JOIN spaces fs ON fs.id = e.from_space_id LEFT JOIN users fsu ON fsu.id = fs.user_id
     LEFT JOIN spaces ts ON ts.id = e.to_space_id LEFT JOIN users tsu ON tsu.id = ts.user_id
     LEFT JOIN pipes fp ON fp.id = e.from_pipe_id
     LEFT JOIN pipes tp ON tp.id = e.to_pipe_id
     LEFT JOIN users fa ON fa.id = e.from_assignee_id
     LEFT JOIN users ta ON ta.id = e.to_assignee_id
     WHERE e.task_id = $1 ORDER BY e.created_at, e.id`,
    [taskId]
  );
  const side = (e: Row, p: "from" | "to") => ({
    location: e[`${p}_space_id`]
      ? {
          spaceId: e[`${p}_space_id`],
          spaceName: e[`${p}_space_name`],
          pipeId: e[`${p}_pipe_id`],
          pipeName: e[`${p}_pipe_name`],
          incoming: !e[`${p}_pipe_id`],
        }
      : null,
    status: e[`${p}_status`],
    stage: e[`${p}_stage`] && localize(lang, e[`${p}_stage`]),
    assignee: e[`${p}_assignee_id`] ? { id: e[`${p}_assignee_id`], name: e[`${p}_assignee_name`] } : null,
    dueDate: e[`${p}_due_date`],
    doc: e[`${p}_doc`],
  });
  return rows.map((e) => ({
    id: e.id,
    type: e.type,
    comment: e.comment,
    details: e.details && localizeDetails(lang, e.details),
    createdAt: e.created_at,
    actor: { id: e.actor_id, name: e.actor_name, avatarUrl: e.actor_avatar },
    from: side(e, "from"),
    to: side(e, "to"),
  }));
}

const MAX_ITEMS = 200;

async function getItems(taskId: string) {
  const { rows } = await query(
    `SELECT i.id, i.text, i.done, i.position, i.done_at, u.name AS done_by_name
     FROM task_items i LEFT JOIN users u ON u.id = i.done_by WHERE i.task_id = $1 ORDER BY i.position, i.created_at`,
    [taskId]
  );
  return rows.map((i) => ({ id: i.id, text: i.text, done: i.done, position: i.position, doneAt: i.done_at, doneBy: i.done_by_name }));
}

async function ensureUser(id: string | null, db?: Queryable): Promise<string | null> {
  if (!id) return null;
  if (!(await one(`SELECT id FROM users WHERE id = $1`, [uuid(id, "User")], db))) throw bad("Unknown user");
  return id;
}

/** Keeps an explicit assignee only where it makes sense: a member of a team space (none in a personal space). */
async function keptAssignee(spaceId: string, assigneeId: string | null, db?: Queryable): Promise<string | null> {
  if (!assigneeId) return null;
  const s = await one(`SELECT kind FROM spaces WHERE id = $1`, [spaceId], db);
  return s?.kind === "team" && (await memberRole(spaceId, assigneeId, db)) ? assigneeId : null;
}

/** Like keptAssignee, but rejects an assignee that was explicitly asked for and cannot be kept. */
async function checkAssignee(spaceId: string, assigneeId: string | null, db?: Queryable): Promise<string | null> {
  const disabled = assigneeId && (await one(`SELECT 1 FROM users WHERE id = $1 AND disabled_at IS NOT NULL`, [assigneeId], db));
  if (assigneeId) await assertSignedInOnce(assigneeId, db);
  if (!assigneeId || (!disabled && (await keptAssignee(spaceId, assigneeId, db)))) return assigneeId;
  const s = await one(`SELECT kind FROM spaces WHERE id = $1`, [spaceId], db);
  throw bad(
    s?.kind === "team"
      ? "The owner must be a member of the team"
      : "A task in a personal space belongs to its holder: send it to someone instead."
  );
}

/**
 * Outline accounts imported from the workspace take part once they have signed in: until then they get no task and
 * join no team, and are invited instead (POST /users/:id/invite).
 */
async function assertSignedInOnce(userId: string, db?: Queryable) {
  const u = await one(`SELECT name FROM users WHERE id = $1 AND auth_kind = 'outline' AND last_login_at IS NULL`, [userId], db);
  if (u) throw bad("{name} has not signed in to TasksPipes yet: invite them first.", { name: u.name });
}

/** The same for a recipient space: the person of a personal space must have signed in once. */
async function assertReachable(spaceId: string) {
  const s = await one(`SELECT user_id FROM spaces WHERE id = $1`, [spaceId]);
  if (s?.user_id) await assertSignedInOnce(s.user_id);
}

async function assertKindAllowed(kind: string, spaceId: string) {
  if (!pipeTypeById(kind)?.teamOnly) return;
  const s = await one(`SELECT kind FROM spaces WHERE id = $1`, [spaceId]);
  if (s?.kind !== "team") {
    throw bad("A “{type}” pipe is created in a team space (the PSH team for instance), not in a personal space.", { type: pipeTypeById(kind)!.label });
  }
}

/** Tasks of a pipe reserved to a team never leave its space (no sending, no move to another space). */
function assertStaysInSpace(t: Row, targetSpaceId: string) {
  if (pipeTypeById(t.pipe_kind)?.teamOnly && targetSpaceId !== t.space_id) {
    throw bad("This task holds confidential data: it cannot leave its space.");
  }
}

/** Adds someone to a team (as a member), if not in it yet. */
async function addMember(db: Queryable, teamId: string, userId: string, addedBy: string) {
  await db.query(
    `INSERT INTO space_members (space_id, user_id, role, added_by)
     SELECT $1, $2, 'member', $3 FROM spaces WHERE id = $1 AND kind = 'team' ON CONFLICT DO NOTHING`,
    [teamId, userId, addedBy]
  );
}

async function requireTeamAdmin(spaceId: string, userId: string) {
  const s = await getSpace(uuid(spaceId, "Space"), userId);
  if (!s) throw notFound("Space not found");
  if (s.kind !== "team") throw bad("Personal spaces cannot be changed");
  if (s.my_role !== "admin") throw forbidden("Only the team's admins can do this");
  return s;
}

async function assertAdminRemains(db: Queryable, spaceId: string) {
  const r = await one(`SELECT count(*) AS n FROM space_members WHERE space_id = $1 AND role = 'admin'`, [spaceId], db);
  if (r!.n < 1) throw bad("The team must keep at least one admin");
}

const presentDoc = (d: OutlineDocument, instance: string) => ({
  id: d.id,
  title: d.title || "Sans titre",
  url: absoluteOutlineUrl(d.url, instance),
  updatedAt: d.updatedAt,
  collectionId: d.collectionId,
});

// ---------------------------------------------------------------------------
// Routes (mounted under /api, all require a session)

export async function apiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => {
    if (!req.user) throw new HttpError(401, "Not signed in");
  });
  const me = (req: FastifyRequest) => req.user!.id;
  await app.register(adminRoutes);
  await app.register(tokenRoutes);
  await app.register(webhookRoutes);
  await app.register(recurrenceRoutes);
  await app.register(accountRoutes, { present: presentTask, events: getEvents });

  app.get("/me", async (req) => ({
    user: req.user,
    personalSpaceId: await personalSpaceId(me(req)),
    outlineUrl: req.outlineUrl,
    // Administrator of the instance (ADMIN_EMAILS): the administration page is offered.
    admin: await requestIsAdmin(req),
    features: { invitations: config.allowEmailInvitations, notifications: notificationState.enabled },
    // E-mail notifications are only offered when e-mail is set up.
    ...(notificationState.enabled
      ? { notificationPrefs: prefsOf((await one(`SELECT notification_prefs FROM users WHERE id = $1`, [me(req)]))?.notification_prefs) }
      : {}),
  }));

  app.put("/me/notifications", async (req: Req) => {
    if (!notificationState.enabled) throw notFound("Not found");
    return { notificationPrefs: await savePrefs(me(req), cleanPrefs(req.body)) };
  });

  // ----- Avatar of e-mail accounts (Outline accounts use their Outline picture) ----

  // A fixed list of checks, not a lookup: a declared type such as "constructor" matches nothing.
  const isAvatarImage = (mime: string, b: Buffer) => {
    switch (mime) {
      case "image/png": return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      case "image/jpeg": return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
      case "image/webp": return b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP";
      case "image/gif": return b.subarray(0, 4).toString() === "GIF8";
      default: return false;
    }
  };

  app.post("/me/avatar", { bodyLimit: 2 * 1024 * 1024 }, async (req: Req) => {
    if (req.user!.kind !== "email") throw bad("The picture of an Outline account is changed in Outline");
    const content = req.body as unknown as Buffer;
    const mime = String(req.headers["x-file-type"] || "");
    // Checked against the file's first bytes, not only its declared type.
    if (!Buffer.isBuffer(content) || !isAvatarImage(mime, content)) throw bad("The picture must be a PNG, JPEG, WebP or GIF image");
    await query(
      `INSERT INTO user_avatars (user_id, mime, content) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET mime = EXCLUDED.mime, content = EXCLUDED.content, updated_at = now()`,
      [me(req), mime, content]
    );
    // The URL changes with each picture, so that it can be cached for long.
    await query(`UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1`, [me(req), `/api/avatars/${me(req)}?v=${Date.now()}`]);
    return { ok: true };
  });

  app.delete("/me/avatar", async (req: Req) => {
    if (req.user!.kind !== "email") throw bad("The picture of an Outline account is changed in Outline");
    await query(`DELETE FROM user_avatars WHERE user_id = $1`, [me(req)]);
    await query(`UPDATE users SET avatar_url = NULL, updated_at = now() WHERE id = $1`, [me(req)]);
    return { ok: true };
  });

  app.get("/avatars/:id", async (req: Req, reply) => {
    const a = await one(`SELECT mime, content FROM user_avatars WHERE user_id = $1`, [uuid(req.params.id, "User")]);
    if (!a) throw notFound();
    return reply
      .header("Content-Type", a.mime)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "sandbox")
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .send(a.content);
  });

  // ----- My account (e-mail accounts: name and TOTP) -------------------------

  // Display preferences (language, theme: null follows the browser), and the name of e-mail accounts.
  app.patch("/me", async (req: Req) => {
    const b = req.body || {};
    const u = req.user!;
    let name = u.name;
    if ("name" in b) {
      if (u.kind !== "email") throw bad("The name of an Outline account is changed in Outline");
      name = text(b.name, "Name", { required: true, max: 120 });
    }
    const locale = "locale" in b ? (b.locale === null ? null : LOCALES.includes(b.locale) ? b.locale : bad("Invalid language")) : u.locale;
    const theme = "theme" in b ? (b.theme === null ? null : ["light", "dark"].includes(b.theme) ? b.theme : bad("Invalid theme")) : u.theme;
    if (locale instanceof HttpError) throw locale;
    if (theme instanceof HttpError) throw theme;
    await query(`UPDATE users SET name = $2, locale = $3, theme = $4, updated_at = now() WHERE id = $1`, [me(req), name, locale, theme]);
    return { ok: true };
  });

  const requireEmailAccount = (req: Req) => {
    if (req.user!.kind !== "email") throw bad("Two-factor authentication is for accounts invited by e-mail; an Outline account sets it up in Outline.");
  };

  // Step 1: a new secret, kept aside until a first code confirms the app is set up.
  app.post("/me/totp/setup", rateLimited(LIMITS.totpSettings), async (req: Req) => {
    requireEmailAccount(req);
    if (req.user!.totp) throw bad("Two-factor authentication is already on");
    const secret = newSecret();
    await query(`UPDATE users SET totp_pending = $2 WHERE id = $1`, [me(req), encrypt(secret)]);
    const url = otpauthUrl(secret, req.user!.email ?? req.user!.name);
    return { secret, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
  });

  app.post("/me/totp/enable", rateLimited(LIMITS.totpSettings), async (req: Req) => {
    requireEmailAccount(req);
    const u = await one(`SELECT totp_pending FROM users WHERE id = $1`, [me(req)]);
    const secret = decrypt(u?.totp_pending);
    if (!secret) throw bad("Start the setup again");
    const step = verifyTotp(secret, String(req.body?.code || ""));
    if (step === null) throw bad("Wrong code: check your phone's clock and try again.");
    await query(`UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = $2 WHERE id = $1`, [me(req), step]);
    return { ok: true };
  });

  app.post("/me/totp/disable", rateLimited(LIMITS.totpSettings), async (req: Req) => {
    requireEmailAccount(req);
    const u = await one(`SELECT totp_secret, totp_last_step FROM users WHERE id = $1`, [me(req)]);
    const secret = decrypt(u?.totp_secret);
    if (!secret) return { ok: true };
    if (verifyTotp(secret, String(req.body?.code || ""), u!.totp_last_step === null ? null : Number(u!.totp_last_step)) === null) {
      throw bad("Wrong code");
    }
    await query(`UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_last_step = NULL WHERE id = $1`, [me(req)]);
    return { ok: true };
  });

  // ----- Calendar subscription (tasks with a due date) ------------------------

  app.get("/me/calendar", async (req) => ({ url: await calendarUrl(me(req)) }));

  // A new link: calendars subscribed with the old one stop receiving tasks.
  app.post("/me/calendar/reset", async (req) => ({ url: await calendarUrl(me(req), { reset: true }) }));

  // ----- Invitations by e-mail ------------------------------------------------

  // My invitations both ways, with their state. Someone asked to connect is only named once they accept.
  app.get("/invitations", async (req) => {
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.avatar_url, u.last_login_at, u.disabled_reason, i.created_at, i.status, i.inviter_id = $1 AS mine
       FROM invitations i JOIN users u ON u.id = CASE WHEN i.inviter_id = $1 THEN i.invitee_id ELSE i.inviter_id END
       WHERE (i.inviter_id = $1 OR i.invitee_id = $1) AND NOT (i.invitee_id = $1 AND i.status = 'refused')
       ORDER BY i.status = 'pending' AND i.invitee_id = $1 DESC, i.created_at DESC`,
      [me(req)]
    );
    return rows.map((r) => {
      const hidden = r.mine && r.status !== "accepted";
      return {
        id: r.id,
        name: hidden ? r.email : r.name,
        email: r.mine ? r.email : null,
        avatarUrl: hidden ? null : r.avatar_url,
        active: Boolean(r.last_login_at),
        // Invited by me, never signed in, link expired: sending a new link turns the account back on.
        expired: r.mine && r.disabled_reason === "unused_invitation",
        invitedByMe: r.mine,
        status: r.status,
        createdAt: r.created_at,
      };
    });
  });

  /** E-mails an invitation (a sign-in link); without e-mail configured, returns the link to pass on by hand. */
  async function sendInvitation(req: Req, invitee: Row) {
    // A new link gives an account disabled for not using the previous one another chance.
    await reenableInvited(invitee.id);
    const link = await createLoginLink(invitee.id, INVITE_LINK_HOURS * 60);
    // In the invitee's language if known, else the inviter's.
    const lang: Locale = invitee.locale ?? localeOf(req);
    const sent = await sendLinkMail(lang, invitee.email, tr(lang, "{name} invites you to TasksPipes", { name: req.user!.name }), [
      tr(lang, "Hello {name},", { name: invitee.name }),
      tr(lang, "{name} invites you to share tasks with them on TasksPipes.", { name: req.user!.name }),
      tr(lang, "This link signs you in directly; it is valid for {hours} hours and works only once. Afterwards, ask for a new link from the sign-in page with your e-mail address.", { hours: INVITE_LINK_HOURS }),
    ], { label: tr(lang, "Join TasksPipes"), url: link });
    return sent ? { sent: true } : { sent: false, link };
  }

  // Invitations send e-mails: a few per person and hour.
  app.post("/invitations", rateLimited({ name: "invitations", max: 30, timeWindow: 3_600_000, keyGenerator: perPerson }), async (req: Req) => {
    if (!config.allowEmailInvitations) throw forbidden("Invitations by e-mail are turned off on this instance");
    const uid = me(req);
    const email = text(req.body?.email, "E-mail", { required: true, max: 254 }).toLowerCase();
    if (!isEmail(email)) throw bad("Invalid e-mail address");
    if (email === req.user!.email?.toLowerCase()) throw bad("That is your own address");
    const name = text(req.body?.name, "Name", { max: 120 }) || email.split("@")[0];
    const teamId = optUuid(req.body?.teamId, "Team");
    if (teamId) await requireTeamAdmin(teamId, uid);

    // Someone already on the platform (an e-mail account first, else an Outline account of this server).
    const existing = await one(
      `SELECT id, name, email, locale, disabled_reason FROM users WHERE lower(email) = $1 AND id <> $2
       ORDER BY auth_kind = 'email' DESC, outline_url = $3 DESC NULLS LAST LIMIT 1`,
      [email, uid, config.outlineUrl]
    );

    // An account disabled because its invitation was never used is invited again, like a new address.
    if (existing?.disabled_reason === "unused_invitation") {
      await tx(async (client) => {
        await reenableInvited(existing.id, client);
        await client.query(
          `INSERT INTO invitations (inviter_id, invitee_id, status) VALUES ($1, $2, 'accepted')
           ON CONFLICT (inviter_id, invitee_id) DO UPDATE SET status = 'accepted', responded_at = now()`,
          [uid, existing.id]
        );
        if (teamId) await addMember(client, teamId, existing.id, uid);
      });
      return { created: true, ...(await sendInvitation(req, existing)) };
    }

    if (!existing) {
      const invitee = await tx(async (client) => {
        const u = await one(
          `INSERT INTO users (id, name, email, auth_kind) VALUES (gen_uuidv7(), $1, $2, 'email') RETURNING id, name, email, locale`,
          [name, email],
          client
        );
        await ensurePersonalSpace(client, u!.id, localeOf(req));
        await client.query(`INSERT INTO invitations (inviter_id, invitee_id, status) VALUES ($1, $2, 'accepted')`, [uid, u!.id]);
        if (teamId) await addMember(client, teamId, u!.id, uid);
        return u!;
      });
      return { created: true, ...(await sendInvitation(req, invitee)) };
    }

    if ((await one(`SELECT user_visible($1, $2) AS ok`, [uid, existing.id]))!.ok) {
      if (teamId) await addMember(pool, teamId, existing.id, uid);
      return { created: false, connected: true, name: existing.name };
    }
    // They had asked me first: inviting them back accepts their request.
    const theirs = await one(
      `UPDATE invitations SET status = 'accepted', responded_at = now()
       WHERE inviter_id = $1 AND invitee_id = $2 AND status = 'pending' RETURNING team_id`,
      [existing.id, uid]
    );
    if (theirs) {
      if (theirs.team_id) await addMember(pool, theirs.team_id, uid, existing.id);
      if (teamId) await addMember(pool, teamId, existing.id, uid);
      notifyUser(existing.id, { type: "connection.accepted", by: req.user!.name });
      return { created: false, connected: true, name: existing.name };
    }
    // Otherwise a request they accept or refuse. A refused one stays refused, without telling the inviter.
    const row = await one(
      `INSERT INTO invitations (inviter_id, invitee_id, status, team_id) VALUES ($1, $2, 'pending', $3)
       ON CONFLICT (inviter_id, invitee_id) DO UPDATE SET team_id = COALESCE(EXCLUDED.team_id, invitations.team_id)
         WHERE invitations.status = 'pending'
       RETURNING (xmax = 0) AS fresh`,
      [uid, existing.id, teamId]
    );
    if (row?.fresh) {
      notifyUser(existing.id, { type: "connection.request", by: req.user!.name });
      const lang: Locale = existing.locale ?? localeOf(req);
      await sendLinkMail(lang, existing.email, tr(lang, "{name} wants to connect with you on TasksPipes", { name: req.user!.name }), [
        tr(lang, "Hello {name},", { name: existing.name }),
        tr(lang, "{name} wants to connect with you on TasksPipes, to share tasks. You can accept or refuse from your dashboard.", { name: req.user!.name }),
      ], { label: tr(lang, "Open TasksPipes"), url: config.appUrl }).catch((err) => req.log.error({ err }, "Connection e-mail failed"));
    }
    // Same answer as for a new address: whether someone has an account is not disclosed.
    return { created: false, sent: true };
  });

  /** Answers a request to connect (`id`: the person who asked). */
  async function answerRequest(req: Req, accept: boolean) {
    const uid = me(req);
    const row = await one(
      `UPDATE invitations SET status = $3, responded_at = now()
       WHERE inviter_id = $1 AND invitee_id = $2 AND status = 'pending' RETURNING inviter_id, team_id`,
      [uuid(req.params.id, "Person"), uid, accept ? "accepted" : "refused"]
    );
    if (!row) throw notFound("Invitation not found");
    if (accept) {
      if (row.team_id) await addMember(pool, row.team_id, uid, row.inviter_id);
      notifyUser(row.inviter_id, { type: "connection.accepted", by: req.user!.name });
    }
    return { ok: true };
  }

  app.post("/invitations/:id/accept", (req: Req) => answerRequest(req, true));
  app.post("/invitations/:id/refuse", (req: Req) => answerRequest(req, false));

  app.post("/invitations/:id/resend", rateLimited({ name: "invitation-links", max: 10, timeWindow: 3_600_000, keyGenerator: perPerson }), async (req: Req) => {
    const invitee = await one(
      `SELECT u.id, u.name, u.email, u.locale FROM invitations i JOIN users u ON u.id = i.invitee_id
       WHERE i.inviter_id = $1 AND i.invitee_id = $2 AND i.status = 'accepted' AND u.auth_kind = 'email'`,
      [me(req), uuid(req.params.id, "Person")]
    );
    if (!invitee) throw notFound("Invitation not found");
    return sendInvitation(req, invitee);
  });

  app.get("/users", async (req) => {
    const { rows } = await query(
      `SELECT u.id, u.name, u.avatar_url, u.last_login_at, u.auth_kind, s.id AS space_id
       FROM users u LEFT JOIN spaces s ON s.user_id = u.id
       WHERE user_visible($1, u.id) ORDER BY lower(u.name)`,
      [me(req)]
    );
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      avatarUrl: u.avatar_url,
      spaceId: u.space_id,
      active: Boolean(u.last_login_at),
      guest: u.auth_kind === "email",
    }));
  });

  // An Outline colleague who never signed in: an e-mail inviting them (or, without e-mail, the link to give them).
  app.post("/users/:id/invite", rateLimited(LIMITS.outlineInvite), async (req: Req) => {
    const id = uuid(req.params.id, "Person");
    const u = await one(
      `SELECT name, email, locale, outline_url, auth_kind, last_login_at FROM users WHERE id = $1 AND user_visible($2, id)`,
      [id, me(req)]
    );
    if (!u) throw bad("Unknown user");
    if (u.auth_kind !== "outline" || u.last_login_at) throw bad("{name} already uses TasksPipes.", { name: u.name });
    const sent = Boolean(u.email) && (await sendOutlineInvite(u.locale ?? config.defaultLocale, u.email, req.user!.name, u.outline_url));
    req.log.info({ userId: id, sent }, "Outline colleague invited");
    return sent ? { sent: true } : { sent: false, link: config.appUrl };
  });

  // ----- Home ---------------------------------------------------------------

  app.get("/home", async (req) => {
    const uid = me(req);
    const [assigned, sent, due] = await Promise.all([
      query(
        `${TASK_SELECT} WHERE COALESCE(t.assignee_id, s.user_id) = $1 AND t.status NOT IN ('done','abandoned') AND p.archived_at IS NULL
         AND (EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = t.space_id AND m.user_id = $1) OR p.visibility = 'open')
         ORDER BY t.due_date NULLS LAST, t.updated_at DESC LIMIT 100`,
        [uid]
      ),
      query(
        `${TASK_SELECT} WHERE t.sender_id = $1 AND t.pipe_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = t.space_id AND m.user_id = $1)
         ORDER BY t.updated_at DESC LIMIT 50`,
        [uid]
      ),
      query(
        `${TASK_SELECT} WHERE t.due_date IS NOT NULL AND t.due_date <= current_date + 7
         AND t.status NOT IN ('done','abandoned') AND p.archived_at IS NULL
         AND EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = t.space_id AND m.user_id = $1)
         ORDER BY t.due_date LIMIT 50`,
        [uid]
      ),
    ]);
    return { assigned: assigned.rows.map(presentTask), sent: sent.rows.map(presentTask), due: due.rows.map(presentTask) };
  });

  // Tasks assigned to me, all pipes together, still to be done (incoming buckets excluded).
  app.get("/me/tasks", async (req) => {
    const uid = me(req);
    const { rows } = await query(
      `${TASK_SELECT} WHERE COALESCE(t.assignee_id, s.user_id) = $1 AND t.status NOT IN ('done','abandoned')
       AND t.pipe_id IS NOT NULL AND p.archived_at IS NULL
       AND (EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = t.space_id AND m.user_id = $1) OR p.visibility = 'open')
       ORDER BY t.due_date NULLS LAST, t.position, t.created_at LIMIT 500`,
      [uid]
    );
    return rows.map(presentTask);
  });

  // ----- Search -------------------------------------------------------------

  // Tasks one can see anywhere, by text or number; filters by status ("open" too), owner and task type.
  app.get("/search", rateLimited(LIMITS.search), async (req: Req) => {
    const q = req.query;
    return searchTasks(me(req), localeOf(req), String(q.q ?? "").slice(0, 200), {
      status: q.status === "open" ? "open" : q.status ? status(q.status) : null,
      owner: optUuid(q.owner, "Owner"),
      type: q.type ? String(q.type).slice(0, 100) : null,
    });
  });

  // ----- Spaces -------------------------------------------------------------

  app.get("/spaces", async (req) => {
    const { rows } = await query(
      `SELECT s.id, s.kind, s.user_id, ${SPACE_NAME} AS name, s.description, s.color, su.avatar_url,
              su.last_login_at, su.auth_kind = 'email' AS guest, m.role AS my_role,
              (SELECT count(*) FROM space_members sm JOIN users mu ON mu.id = sm.user_id
                 WHERE sm.space_id = s.id AND mu.disabled_at IS NULL) AS member_count,
              CASE WHEN m.role IS NOT NULL THEN
                (SELECT count(*) FROM tasks t WHERE t.space_id = s.id AND t.pipe_id IS NULL) END AS incoming_count,
              (SELECT count(*) FROM pipes p WHERE p.space_id = s.id AND p.archived_at IS NULL
                 AND (p.visibility = 'open' OR m.role IS NOT NULL)) AS pipe_count
       FROM spaces s
       LEFT JOIN users su ON su.id = s.user_id
       LEFT JOIN space_members m ON m.space_id = s.id AND m.user_id = $1
       WHERE space_visible($1, s.id)
       ORDER BY lower(${SPACE_NAME})`,
      [me(req)]
    );
    return rows.map((s) => ({
      id: s.id,
      kind: s.kind,
      userId: s.user_id,
      name: s.name,
      description: s.description,
      color: s.color,
      avatarUrl: s.avatar_url,
      active: s.kind === "team" || Boolean(s.last_login_at),
      guest: Boolean(s.guest),
      myRole: s.my_role,
      memberCount: s.member_count,
      incomingCount: s.incoming_count,
      pipeCount: s.pipe_count,
    }));
  });

  app.post("/spaces", async (req: Req) => {
    const uid = me(req);
    const name = text(req.body?.name, "Name", { required: true, max: 120 });
    const description = text(req.body?.description, "Description");
    const members: { userId: string; role?: string }[] = Array.isArray(req.body?.members) ? req.body.members : [];
    const id = await tx(async (client) => {
      const space = await one(
        `INSERT INTO spaces (kind, name, description, color, created_by) VALUES ('team', $1, $2, $3, $4) RETURNING id`,
        [name, description, color(req.body?.color), uid],
        client
      );
      await client.query(`INSERT INTO space_members (space_id, user_id, role, added_by) VALUES ($1, $2, 'admin', $2)`, [space!.id, uid]);
      for (const m of members) {
        if (m.userId === uid) continue;
        await ensureUser(m.userId, client);
        // Only people one can see, as when adding a member to an existing team.
        if (!(await one(`SELECT user_visible($1, $2) AS ok`, [uid, m.userId], client))?.ok) throw bad("Unknown user");
        await assertSignedInOnce(m.userId, client);
        await client.query(
          `INSERT INTO space_members (space_id, user_id, role, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [space!.id, m.userId, m.role === "admin" ? "admin" : "member", uid]
        );
      }
      return space!.id as string;
    });
    req.log.info({ spaceId: id }, "Team space created");
    return { id };
  });

  app.get("/spaces/:id", async (req: Req) => {
    const s = await getSpace(uuid(req.params.id, "Space"), me(req));
    if (!s) throw notFound("Space not found");
    const isMember = Boolean(s.my_role);
    const [members, pipes, incoming] = await Promise.all([
      query(
        // Accounts disabled by an administrator stay listed, marked; unused invitations do not.
        `SELECT u.id, u.name, u.avatar_url, m.role, u.disabled_at IS NOT NULL AS disabled FROM space_members m JOIN users u ON u.id = m.user_id
         WHERE m.space_id = $1 AND (u.disabled_at IS NULL OR u.disabled_reason = 'admin') ORDER BY m.role, lower(u.name)`,
        [s.id]
      ),
      query(
        `SELECT p.*, u.name AS created_by_name, ${PIPE_COUNTS}
         FROM pipes p LEFT JOIN users u ON u.id = p.created_by
         WHERE p.space_id = $1 AND (p.visibility = 'open' OR $2)
         ORDER BY p.archived_at NULLS FIRST, p.position, p.created_at`,
        [s.id, isMember]
      ),
      isMember
        ? query(`${TASK_SELECT} WHERE t.space_id = $1 AND t.pipe_id IS NULL ORDER BY t.position, t.created_at`, [s.id])
        : null,
    ]);
    return {
      id: s.id,
      kind: s.kind,
      userId: s.user_id,
      name: s.name,
      description: s.description,
      color: s.color,
      avatarUrl: s.avatar_url,
      myRole: s.my_role,
      members: members.rows.map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatar_url, role: m.role, disabled: m.disabled })),
      pipes: pipes.rows.map(presentPipe),
      incoming: incoming ? incoming.rows.map(presentTask) : null,
    };
  });

  app.patch("/spaces/:id", async (req: Req) => {
    const s = await requireTeamAdmin(req.params.id, me(req));
    const b = req.body || {};
    await query(`UPDATE spaces SET name = $2, description = $3, color = $4 WHERE id = $1`, [
      s.id,
      "name" in b ? text(b.name, "Name", { required: true, max: 120 }) : s.name,
      "description" in b ? text(b.description, "Description") : s.description,
      "color" in b ? color(b.color) : s.color,
    ]);
    return { ok: true };
  });

  app.delete("/spaces/:id", async (req: Req) => {
    const s = await requireTeamAdmin(req.params.id, me(req));
    const n = await one(`SELECT count(*) AS n FROM tasks WHERE space_id = $1`, [s.id]);
    if (n!.n > 0) throw bad("The team still holds tasks: move or send them before deleting it.");
    await query(`DELETE FROM spaces WHERE id = $1`, [s.id]);
    return { ok: true };
  });

  app.post("/spaces/:id/members", async (req: Req) => {
    const s = await requireTeamAdmin(req.params.id, me(req));
    const userId = await ensureUser(optUuid(req.body?.userId, "User"));
    if (!userId) throw bad("A user is required");
    // Only people one can see: someone invited by e-mail joins a team through whoever invited them.
    if (!(await one(`SELECT user_visible($1, $2) AS ok`, [me(req), userId]))?.ok) throw bad("Unknown user");
    await assertSignedInOnce(userId);
    await query(
      `INSERT INTO space_members (space_id, user_id, role, added_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (space_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [s.id, userId, req.body?.role === "admin" ? "admin" : "member", me(req)]
    );
    return { ok: true };
  });

  app.patch("/spaces/:id/members/:userId", async (req: Req) => {
    const s = await requireTeamAdmin(req.params.id, me(req));
    const role = req.body?.role === "admin" ? "admin" : "member";
    await tx(async (client) => {
      await client.query(`UPDATE space_members SET role = $3 WHERE space_id = $1 AND user_id = $2`, [
        s.id,
        uuid(req.params.userId, "User"),
        role,
      ]);
      await assertAdminRemains(client, s.id);
    });
    return { ok: true };
  });

  app.delete("/spaces/:id/members/:userId", async (req: Req) => {
    const spaceId = uuid(req.params.id, "Space");
    const userId = uuid(req.params.userId, "User");
    if (userId !== me(req)) await requireTeamAdmin(spaceId, me(req));
    else {
      const s = await getSpace(spaceId, me(req));
      if (!s || s.kind !== "team") throw bad("This space cannot be left");
    }
    await tx(async (client) => {
      await client.query(`DELETE FROM space_members WHERE space_id = $1 AND user_id = $2`, [spaceId, userId]);
      await assertAdminRemains(client, spaceId);
    });
    return { ok: true };
  });

  // ----- Pipes --------------------------------------------------------------

  // In the language of the page; select options keep their stored values (see localizeTaskType).
  // Types I turned off are flagged `disabled`; so is a task type offered only by pipe types I turned off.
  app.get("/catalog", async (req) => {
    const lang = localeOf(req);
    const off = new Set<string>((await one(`SELECT disabled_pipe_types FROM users WHERE id = $1`, [me(req)]))?.disabled_pipe_types ?? []);
    const pipeTypes = allPipeTypes();
    const offeredBy = (id: string) => pipeTypes.filter((p) => p.taskTypes.includes(id));
    return {
      pipeTypes: pipeTypes.map((p) => ({ ...localizePipeType(lang, p), disabled: off.has(p.id) })),
      taskTypes: allTaskTypes().map((t) => {
        const by = offeredBy(t.id);
        return { ...localizeTaskType(lang, t), disabled: by.length > 0 && by.every((p) => off.has(p.id)) };
      }),
    };
  });

  // Turns pipe types off or on for me (the general type, behind personal pipes, always stays on).
  app.put("/me/disabled-pipe-types", async (req: Req) => {
    const ids = req.body?.pipeTypes;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) throw bad("Invalid pipe type");
    const known = new Set(allPipeTypes().map((p) => p.id));
    const list = [...new Set(ids as string[])].filter((id) => known.has(id) && id !== DEFAULT_PIPE_TYPE);
    await query(`UPDATE users SET disabled_pipe_types = $2 WHERE id = $1`, [me(req), list]);
    return { pipeTypes: list };
  });

  // ----- Designer: pipe and task types made by users -----------------------

  app.get("/catalog/usage", rateLimited(LIMITS.catalogUsage), async () => {
    const [pipes, tasks] = await Promise.all([
      query(`SELECT kind, count(*)::int AS n FROM pipes GROUP BY kind`),
      query(`SELECT task_type, count(*)::int AS n FROM tasks GROUP BY task_type`),
    ]);
    return {
      pipeTypes: Object.fromEntries(pipes.rows.map((r) => [r.kind, r.n])),
      taskTypes: Object.fromEntries(tasks.rows.map((r) => [r.task_type, r.n])),
    };
  });

  const CATALOG_KINDS = { "pipe-types": "pipe", "task-types": "task" } as const;
  const catalogKind = (v: string) => {
    const k = CATALOG_KINDS[v as keyof typeof CATALOG_KINDS];
    if (!k) throw notFound("Not found");
    return k;
  };

  /** A type made with the designer, which only its author may change. */
  async function loadCustomType(kind: "pipe" | "task", id: string, userId: string) {
    const row = await one(`SELECT * FROM custom_types WHERE id = $1 AND kind = $2`, [id, kind]);
    if (!row) throw notFound(kind === "pipe" ? "Pipe type not found (built-in types can be duplicated)" : "Task type not found (built-in types can be duplicated)");
    if (row.created_by !== userId) throw forbidden("Only the author of this model can change it: duplicate it to make your own version.");
    return row;
  }

  // Models as YAML files: export the given types (and the custom task types their pipe types offer)…
  app.get("/catalog/export", async (req: Req, reply) => {
    const ids = (v: unknown) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
    const yaml = exportModels(ids(req.query.pipeTypes), ids(req.query.taskTypes), me(req), localeOf(req));
    return reply
      .type("application/yaml; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="taskspipes-models.yml"')
      .send(yaml);
  });

  // …and import a file as new private models, all or nothing.
  app.post("/catalog/import", async (req: Req) => {
    const text = typeof req.body?.yaml === "string" ? req.body.yaml : "";
    if (!text.trim()) throw bad("Choose a model file");
    if (text.length > 512 * 1024) throw bad("This file is too large for a model file");
    const created = await tx((client) => importModels(client, text, me(req)));
    await loadCustomTypes();
    return { created };
  });

  app.post("/catalog/:kind", async (req: Req) => {
    const kind = catalogKind(req.params.kind);
    const definition = kind === "pipe" ? validatePipeType(req.body, me(req)) : validateTaskType(req.body);
    const row = await one(
      `INSERT INTO custom_types (id, kind, definition, created_by) VALUES (gen_uuidv7()::text, $1, $2, $3) RETURNING id`,
      [kind, JSON.stringify(definition), me(req)]
    );
    await loadCustomTypes();
    return { id: row!.id };
  });

  app.put("/catalog/:kind/:id", async (req: Req) => {
    const kind = catalogKind(req.params.kind);
    const row = await loadCustomType(kind, String(req.params.id), me(req));
    if (kind === "pipe") {
      const definition = validatePipeType(req.body, me(req), pipeTypeById(row.id));
      if (definition.teamOnly) {
        const personal = await one(
          `SELECT count(*)::int AS n FROM pipes p JOIN spaces s ON s.id = p.space_id WHERE p.kind = $1 AND s.kind = 'user'`,
          [row.id]
        );
        if (personal!.n) throw bad("{n} pipe(s) of this type are in personal spaces: it cannot be reserved to a team.", { n: personal!.n });
      }
      await tx(async (client) => {
        await client.query(`UPDATE custom_types SET definition = $2, updated_at = now() WHERE id = $1`, [row.id, JSON.stringify(definition)]);
        if (definition.confidential) await client.query(`UPDATE pipes SET visibility = 'private' WHERE kind = $1`, [row.id]);
      });
      await loadCustomTypes();
      // Tasks of a removed column go to the nearest one; a column's new state applies to its tasks.
      await syncStages(row.id);
    } else {
      const definition = validateTaskType(req.body, taskTypeById(row.id));
      await query(`UPDATE custom_types SET definition = $2, updated_at = now() WHERE id = $1`, [row.id, JSON.stringify(definition)]);
      await loadCustomTypes();
    }
    return { ok: true };
  });

  app.delete("/catalog/:kind/:id", async (req: Req) => {
    const kind = catalogKind(req.params.kind);
    const row = await loadCustomType(kind, String(req.params.id), me(req));
    if (kind === "pipe") {
      const used = await one(`SELECT count(*)::int AS n FROM pipes WHERE kind = $1`, [row.id]);
      if (used!.n) throw bad("{n} pipe(s) use this type (archived ones included): it cannot be deleted.", { n: used!.n });
    } else {
      const used = await one(`SELECT count(*)::int AS n FROM tasks WHERE task_type = $1`, [row.id]);
      if (used!.n) throw bad("{n} task(s) use this type: it cannot be deleted.", { n: used!.n });
      const inPipes = allPipeTypes().filter((p) => p.taskTypes.includes(row.id));
      if (inPipes.length) throw bad("This type is offered in: {types}. Remove it from these pipe types first.", { types: inPipes.map((p) => `“${p.label}”`).join(", ") });
    }
    await query(`DELETE FROM custom_types WHERE id = $1`, [row.id]);
    await loadCustomTypes();
    return { ok: true };
  });

  // Sidebar: my personal pipes, and the pipes I pinned that I can still see.
  app.get("/sidebar", async (req) => {
    const uid = me(req);
    const [mine, pinned, teams] = await Promise.all([
      query(
        `SELECT p.*, ${PIPE_COUNTS} FROM pipes p JOIN spaces s ON s.id = p.space_id
         WHERE s.user_id = $1 AND p.archived_at IS NULL ORDER BY p.position, p.created_at`,
        [uid]
      ),
      query(
        `SELECT p.*, ${SPACE_NAME} AS space_name, ${PIPE_COUNTS},
                EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = p.space_id AND m.user_id = $1) AS can_manage
         FROM pipe_pins pp
         JOIN pipes p ON p.id = pp.pipe_id
         JOIN spaces s ON s.id = p.space_id LEFT JOIN users su ON su.id = s.user_id
         WHERE pp.user_id = $1 AND p.archived_at IS NULL AND space_visible($1, p.space_id)
           AND (p.visibility = 'open' OR EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = p.space_id AND m.user_id = $1))
         ORDER BY pp.created_at`,
        [uid]
      ),
      // Pipes of the teams I belong to.
      query(
        `SELECT p.*, ${PIPE_COUNTS} FROM pipes p
         JOIN space_members m ON m.space_id = p.space_id AND m.user_id = $1
         JOIN spaces s ON s.id = p.space_id AND s.kind = 'team'
         WHERE p.archived_at IS NULL ORDER BY p.position, p.created_at`,
        [uid]
      ),
    ]);
    return {
      mine: mine.rows.map((p) => ({ ...presentPipe(p), canManage: true })),
      teams: teams.rows.map((p) => ({ ...presentPipe(p), canManage: true })),
      pinned: pinned.rows.map((p) => ({ ...presentPipe(p), spaceName: p.space_name, canManage: p.can_manage })),
    };
  });

  app.put("/pipes/:id/pin", async (req: Req) => {
    const { p } = await loadPipeFor(req.params.id, me(req));
    await query(`INSERT INTO pipe_pins (user_id, pipe_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me(req), p.id]);
    return { ok: true };
  });

  app.delete("/pipes/:id/pin", async (req: Req) => {
    await query(`DELETE FROM pipe_pins WHERE user_id = $1 AND pipe_id = $2`, [me(req), uuid(req.params.id, "Pipe")]);
    return { ok: true };
  });

  app.post("/spaces/:id/pipes", async (req: Req) => {
    const uid = me(req);
    const spaceId = uuid(req.params.id, "Space");
    if (!(await memberRole(spaceId, uid))) throw forbidden();
    const kind = pipeKind(req.body?.kind, me(req));
    await assertKindAllowed(kind, spaceId);
    const id = await tx(async (client) => {
      const row = await one(
        `INSERT INTO pipes (space_id, name, description, visibility, kind, color, icon, created_by, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT COALESCE(max(position), 0) + 1 FROM pipes WHERE space_id = $1))
         RETURNING id`,
        [
          spaceId,
          text(req.body?.name, "Name", { required: true, max: 120 }),
          text(req.body?.description, "Description"),
          req.body?.visibility === "open" && !pipeTypeById(kind)!.confidential ? "open" : "private",
          kind,
          color(req.body?.color),
          icon(req.body?.icon),
          uid,
        ],
        client
      );
      // Starter tasks of a process type, in its first column.
      if (req.body?.withTemplates) {
        const first = pipeTypeById(kind)!.columns[0];
        for (const [i, title] of pipeTypeById(kind)!.templates.entries()) {
          const { rows } = await client.query(
            `INSERT INTO tasks (title, space_id, pipe_id, status, stage, position, author_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [localize(localeOf(req), title), spaceId, row!.id, first.status, first.id, i + 1, uid]
          );
          const t = await getTaskRow(rows[0].id, client);
          await recordEvent(client, t!.id, uid, "created", null, snapshot(t!));
        }
      }
      return row!.id as string;
    });
    return { id };
  });

  app.get("/pipes/:id", async (req: Req) => {
    const { p, role } = await loadPipeFor(req.params.id, me(req));
    const [space, tasks] = await Promise.all([
      getSpace(p.space_id, me(req)),
      query(`${TASK_SELECT} WHERE t.pipe_id = $1 ORDER BY t.position, t.created_at`, [p.id]),
    ]);
    const counts: Record<string, number> = {};
    for (const t of tasks.rows) counts[t.status] = (counts[t.status] ?? 0) + 1;
    return {
      ...presentPipe({ ...p, counts }),
      space: { id: space!.id, name: space!.name, kind: space!.kind, userId: space!.user_id, avatarUrl: space!.avatar_url, color: space!.color },
      myRole: role,
      canManage: Boolean(role),
      canAddTasks: !p.archived_at && (Boolean(role) || p.visibility === "open"),
      tasks: tasks.rows.map(presentTask),
    };
  });

  // ----- Export and import of a pipe's tasks --------------------------------

  // Anyone who sees the pipe may export it, as CSV (one column per field) or JSON.
  app.get("/pipes/:id/export", rateLimited(LIMITS.pipeExport), async (req: Req, reply) => {
    const uid = me(req);
    const lang = localeOf(req);
    const { p } = await loadPipeFor(req.params.id, uid);
    const { rows } = await query(
      `SELECT t.number, t.title, t.description, t.status, t.stage, t.task_type, t.fields, t.due_date, t.created_at, t.updated_at,
              au.name AS author_name, ow.name AS owner_name,
              COALESCE((SELECT json_agg(json_build_object('text', i.text, 'done', i.done) ORDER BY i.position, i.created_at)
                        FROM task_items i WHERE i.task_id = t.id), '[]') AS items
       FROM tasks t JOIN spaces s ON s.id = t.space_id JOIN users au ON au.id = t.author_id
       LEFT JOIN users ow ON ow.id = COALESCE(s.user_id, t.assignee_id)
       WHERE t.pipe_id = $1 ORDER BY t.position, t.created_at`,
      [p.id]
    );
    // People named in fields, by name — only those one may see, as in the app.
    const ids = [...new Set(rows.flatMap((t) => Object.values(t.fields as Row).filter((v): v is string => typeof v === "string" && UUID.test(v))))];
    const named = ids.length ? await query(`SELECT id, name FROM users WHERE id = ANY($1) AND user_visible($2, id)`, [ids, uid]) : { rows: [] };
    const names = new Map(named.rows.map((u) => [u.id as string, u.name as string]));
    const key = (n: number) => `${TASK_KEY_PREFIX}-${n}`;
    const file = (p.name.normalize("NFD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "pipe").slice(0, 60);
    const json = req.query.format === "json";
    reply.header("content-disposition", `attachment; filename="${file}.${json ? "json" : "csv"}"`);
    reply.header("cache-control", "no-store");
    if (json) return reply.type("application/json; charset=utf-8").send(JSON.stringify(exportJson({ name: p.name, kind: p.kind }, rows as ExportedTask[], lang, names, key), null, 2));
    // Spreadsheets in French expect semicolons.
    const sep = req.query.sep === ";" || (req.query.sep === undefined && lang === "fr") ? ";" : ",";
    return reply.type("text/csv; charset=utf-8").send(exportCsv(p.kind, rows as ExportedTask[], lang, names, key, sep));
  });

  /** An import checked against the pipe, for its members: a CSV file and how its columns map, or a Trello board. */
  async function importPlan(req: Req) {
    const uid = me(req);
    const lang = localeOf(req);
    const { p, role } = await loadPipeFor(req.params.id, uid);
    if (!role) throw forbidden("Only the space's members can import tasks");
    if (p.archived_at) throw bad("This pipe is archived");
    const b = req.body || {};
    const content = typeof b.content === "string" ? b.content : "";
    if (!content.trim()) throw bad("Choose a file");
    const trello = b.source === "trello";
    let rows: string[][];
    if (trello) {
      let board: unknown;
      try {
        board = JSON.parse(content);
      } catch {
        throw bad("This is not a Trello board exported as JSON");
      }
      rows = trelloRows(board, lang);
    } else rows = csvRows(content);
    const allowed = new Set(targetsFor(p.kind, lang).map((t) => t.id as string).concat("comments"));
    const mapping: Record<string, Target> = trello ? TRELLO_MAPPING : {};
    if (!trello && b.mapping && typeof b.mapping === "object") {
      for (const [i, t] of Object.entries(b.mapping as Record<string, unknown>)) if (typeof t === "string" && allowed.has(t) && t !== "comments") mapping[i] = t as Target;
    }
    const columnValues: Record<string, string> = {};
    for (const [v, c] of Object.entries((b.columnValues ?? {}) as Record<string, unknown>)) if (typeof c === "string") columnValues[v] = c;
    const space = await one(`SELECT kind, user_id FROM spaces WHERE id = $1`, [p.space_id]);
    // Possible owners: the members who could be given a task (signed in once, not disabled).
    const people = await query(
      `SELECT u.id, u.name, u.email FROM space_members m JOIN users u ON u.id = m.user_id
       WHERE m.space_id = $1 AND u.disabled_at IS NULL AND (u.auth_kind <> 'outline' OR u.last_login_at IS NOT NULL)`,
      [p.space_id]
    );
    const plan = planImport(p.kind, lang, { rows, mapping, taskType: typeof b.taskType === "string" ? b.taskType : undefined, columnValues },
      people.rows as Person[], space?.kind === "user" ? space.user_id : null);
    return { p, plan, lang, source: trello ? "trello" : "csv", people: people.rows };
  }

  const IMPORT_BODY = { bodyLimit: 12 * 1024 * 1024 };

  // What an import would do: the columns and their targets, the first tasks, every error.
  app.post("/pipes/:id/import/preview", { ...IMPORT_BODY, ...rateLimited(LIMITS.pipeImportPreview) }, async (req: Req) => {
    const { p, plan, lang, people } = await importPlan(req);
    const names = new Map(people.map((u) => [u.id as string, u.name as string]));
    return {
      headers: plan.headers,
      mapping: plan.mapping,
      targets: targetsFor(p.kind, lang),
      taskTypes: taskTypesOf(p.kind).map((t) => ({ id: t.id, label: localize(lang, t.label) })),
      columns: columnsFor(p.kind, lang),
      columnValues: plan.columnValues,
      count: plan.tasks.length,
      tasks: plan.tasks.slice(0, 20).map((t) => ({ ...t, owner: t.assigneeId ? names.get(t.assigneeId) ?? null : null })),
      errors: plan.errors.slice(0, 200),
      errorCount: plan.errors.length,
    };
  });

  // The import itself: all lines or none, in one transaction, without e-mail notifications.
  app.post("/pipes/:id/import", { ...IMPORT_BODY, ...rateLimited(LIMITS.pipeImport) }, async (req: Req, reply) => {
    const uid = me(req);
    const { p, plan, lang, source } = await importPlan(req);
    if (plan.errors.length) {
      return reply.code(400).send({
        error: tr(lang, "{n} lines cannot be imported: nothing was imported", { n: plan.errors.length }),
        errors: plan.errors.slice(0, 200),
      });
    }
    if (!plan.tasks.length) throw bad("The file holds no task");
    const created = await tx(async (client) => {
      const positions = new Map<string, number>();
      for (const t of plan.tasks) {
        const position = (positions.get(t.stage) ?? (await nextPosition(client, p.space_id, p.id, t.stage)) - 1) + 1;
        positions.set(t.stage, position);
        const row = await one(
          `INSERT INTO tasks (title, description, space_id, pipe_id, status, stage, position, assignee_id, due_date, author_id, task_type, fields)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING id`,
          [t.title, t.description, p.space_id, p.id, t.status, t.stage, position, t.assigneeId, t.dueDate, uid, t.taskType, JSON.stringify(t.fields)],
          client
        ).then((r) => getTaskRow(r!.id, client));
        for (const [i, item] of t.items.entries()) {
          await client.query(
            `INSERT INTO task_items (task_id, text, done, position, done_by, done_at)
             VALUES ($1, $2, $3, $4, CASE WHEN $3 THEN $5::uuid END, CASE WHEN $3 THEN now() END)`,
            [row!.id, item.text, item.done, i + 1, uid]
          );
        }
        const s = snapshot(row!);
        await recordEvent(client, row!.id, uid, "created", null, s, null, { imported: source }, false);
        for (const c of t.comments) await recordEvent(client, row!.id, uid, "comment", s, s, c, null, false);
      }
      return plan.tasks.length;
    });
    req.log.info({ pipeId: p.id, created, source }, "Tasks imported");
    notifySpace(p.space_id, { type: "task.updated" }, uid);
    return { created };
  });

  app.patch("/pipes/:id", async (req: Req) => {
    const { p, role } = await loadPipeFor(req.params.id, me(req));
    if (!role) throw forbidden();
    const b = req.body || {};
    if (b.archived && !p.archived_at) {
      if (p.is_default) throw bad("The default pipe of a personal space cannot be archived");
      // Like a task, a pipe is closed once its work is over: no task left in progress.
      const open = await one(`SELECT count(*) AS n FROM tasks WHERE pipe_id = $1 AND status NOT IN ('done','abandoned')`, [p.id]);
      if (open!.n > 0) {
        throw bad("This pipe still has {n} open task(s): finish, drop or move them before archiving it.", { n: open!.n });
      }
    }
    const kind = "kind" in b ? pipeKind(b.kind, me(req), p.kind) : p.kind;
    if (kind !== p.kind) await assertKindAllowed(kind, p.space_id);
    await tx(async (client) => {
    await client.query(
      `UPDATE pipes SET name = $2, description = $3, visibility = $4, color = $5, kind = $6, icon = $8,
         archived_at = CASE WHEN $7::boolean IS NULL THEN archived_at WHEN $7 THEN COALESCE(archived_at, now()) END,
         daily_report = $9, weekly_report = $10, updated_at = now()
       WHERE id = $1`,
      [
        p.id,
        "name" in b ? text(b.name, "Name", { required: true, max: 120 }) : p.name,
        "description" in b ? text(b.description, "Description") : p.description,
        // A confidential type (sensitive personal data) is never open.
        pipeTypeById(kind)?.confidential ? "private" : "visibility" in b ? (b.visibility === "open" ? "open" : "private") : p.visibility,
        "color" in b ? color(b.color) : p.color,
        kind,
        "archived" in b ? Boolean(b.archived) : null,
        "icon" in b ? icon(b.icon) : p.icon,
        // Reports sent by e-mail: the weekly time report is for development pipes only.
        "dailyReport" in b ? b.dailyReport === true : p.daily_report,
        pipeTypeById(kind)?.timeReport ? ("weeklyReport" in b ? b.weeklyReport === true : p.weekly_report) : false,
      ]
    );
    // A new type brings new columns: each task goes to the matching one.
    if (kind !== p.kind) {
      const { rows } = await client.query(`SELECT id, stage, status FROM tasks WHERE pipe_id = $1`, [p.id]);
      for (const t of rows) {
        const c = resolveStage(kind, t.stage, t.status);
        await client.query(`UPDATE tasks SET stage = $2, status = $3 WHERE id = $1`, [t.id, c.id, c.status]);
      }
    }
    });
    return { ok: true };
  });

  app.delete("/pipes/:id", async (req: Req) => {
    const { p, role } = await loadPipeFor(req.params.id, me(req));
    if (!role) throw forbidden();
    if (p.is_default) throw bad("The default pipe of a personal space cannot be deleted");
    const n = await one(`SELECT count(*) AS n FROM tasks WHERE pipe_id = $1`, [p.id]);
    if (n!.n > 0) throw bad("This pipe still holds tasks: move them before deleting it.");
    await query(`DELETE FROM pipes WHERE id = $1`, [p.id]);
    return { ok: true };
  });

  // ----- Tasks --------------------------------------------------------------

  app.post("/tasks", async (req: Req) => {
    const uid = me(req);
    const b = req.body || {};
    const title = text(b.title, "Title", { required: true, max: 300 });
    const description = text(b.description, "Description");
    const dueDate = dateOrNull(b.dueDate);
    const doc = docOrNull(b.outlineDoc);
    const comment = text(b.comment, "Comment") || null;
    const type = taskType(b.taskType);
    const { values } = cleanFields(type, b.fields ?? {});
    if (b.items !== undefined && !Array.isArray(b.items)) throw bad("Invalid sub-tasks");
    const items = ((b.items ?? []) as unknown[])
      .map((x) => (typeof x === "object" && x ? x : { text: x }) as { text?: unknown; done?: unknown })
      .map((x) => ({ text: text(x.text, "Sub-task", { max: 500 }), done: x.done === true }))
      .filter((x) => x.text)
      .slice(0, MAX_ITEMS);
    let st = status(b.status);
    let stage: string | null = null;

    let spaceId: string;
    let pipeId: string | null = null;
    let senderId: string | null = null;
    if (b.pipeId) {
      // Creating straight into a pipe: own pipe, or someone else's open pipe.
      const { p } = await loadPipeFor(b.pipeId, uid);
      if (p.archived_at) throw bad("This pipe is archived");
      spaceId = p.space_id;
      pipeId = p.id;
      const c = resolveStage(p.kind, b.stage, b.status === undefined ? null : st);
      st = c.status;
      stage = c.id;
      assertTaskTypeUsable(type, uid, p.kind);
    } else {
      assertTaskTypeUsable(type, uid, null);
      // Otherwise the task is sent to a space's incoming bucket.
      spaceId = uuid(b.spaceId, "Space");
      if (!(await spaceVisible(spaceId, uid))) throw notFound("Space not found");
      await assertReachable(spaceId);
      senderId = uid;
    }
    const assigneeId = await checkAssignee(spaceId, await ensureUser(optUuid(b.assigneeId, "Owner")));

    const id = await tx(async (client) => {
      const position = await nextPosition(client, spaceId, pipeId, stage);
      const row = await one(
        `INSERT INTO tasks (title, description, space_id, pipe_id, status, stage, position, assignee_id, due_date,
                            outline_doc_id, outline_doc_title, outline_doc_url, author_id, sender_id, task_type, fields)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,jsonb_strip_nulls($16::jsonb)) RETURNING id`,
        [title, description, spaceId, pipeId, st, stage, position, assigneeId, dueDate,
         doc?.id ?? null, doc?.title ?? null, doc?.url ?? null, uid, senderId, type.id, JSON.stringify(values)],
        client
      ).then((r) => getTaskRow(r!.id, client));
      for (const [i, item] of items.entries()) {
        await client.query(
          `INSERT INTO task_items (task_id, text, done, position, done_by, done_at)
           VALUES ($1, $2, $3, $4, CASE WHEN $3 THEN $5::uuid END, CASE WHEN $3 THEN now() END)`,
          [row!.id, item.text, item.done, i + 1, uid]
        );
      }
      await recordEvent(client, row!.id, uid, pipeId ? "created" : "sent", null, snapshot(row!), comment);
      return row!.id as string;
    });
    if (!pipeId) {
      const row = await getTaskRow(id);
      notifySpace(spaceId, { type: "task.sent", task: { id, number: row!.number, title }, by: req.user!.name }, uid);
    }
    return { id };
  });

  app.get("/tasks/:id", async (req: Req) => {
    const { t, perms } = await loadTaskFor(req.params.id, me(req));
    const [events, files, items, links] = await Promise.all([
      getEvents(t.id, localeOf(req)),
      query(
        `SELECT f.id, f.field, f.name, f.mime, f.size, f.created_at, u.name AS uploaded_by_name
         FROM task_files f JOIN users u ON u.id = f.uploaded_by WHERE f.task_id = $1 ORDER BY f.created_at`,
        [t.id]
      ),
      getItems(t.id),
      query(
        `SELECT provider, kind, url, number, title, state, repo, author, updated_at FROM task_links
         WHERE task_id = $1 ORDER BY kind = 'commit', updated_at DESC LIMIT 100`,
        [t.id]
      ),
    ]);
    return {
      ...presentTask(t),
      permissions: perms,
      recurrence: t.recurrence_id ? presentRecurrence(await one(`SELECT * FROM task_recurrences WHERE id = $1`, [t.recurrence_id])) : null,
      occurrenceOn: t.occurrence_on,
      events,
      items,
      key: `${TASK_KEY_PREFIX}-${t.number}`,
      timing: stepTimes(events),
      gitConnected: Boolean(t.pipe_id && (await one(`SELECT 1 FROM pipe_integrations WHERE pipe_id = $1 LIMIT 1`, [t.pipe_id]))),
      links: links.rows.map((l) => ({
        provider: l.provider, kind: l.kind, url: l.url, number: l.number, title: l.title, state: l.state,
        repo: l.repo, author: l.author, updatedAt: l.updated_at,
      })),
      files: files.rows.map((f) => ({
        id: f.id, field: f.field, name: f.name, mime: f.mime, size: f.size, createdAt: f.created_at, uploadedBy: f.uploaded_by_name,
      })),
    };
  });

  app.patch("/tasks/:id", async (req: Req) => {
    const uid = me(req);
    const { t, perms } = await loadTaskFor(req.params.id, uid, "editContent");
    const b = req.body || {};
    if (["assigneeId", "dueDate", "outlineDoc", "status", "stage"].some((k) => k in b) && !perms.manage) throw forbidden();

    const title = "title" in b ? text(b.title, "Title", { required: true, max: 300 }) : t.title;
    const description = "description" in b ? text(b.description, "Description") : t.description;
    const assigneeId =
      "assigneeId" in b ? await checkAssignee(t.space_id, await ensureUser(optUuid(b.assigneeId, "Owner"))) : t.assignee_id;
    const dueDate = "dueDate" in b ? dateOrNull(b.dueDate) : t.due_date;
    let st: Status = "status" in b ? status(b.status) : t.status;
    let stage: string | null = t.stage;
    if (t.pipe_id && ("stage" in b || "status" in b)) {
      const c = resolveStage(t.pipe_kind, b.stage, st);
      st = c.status;
      stage = c.id;
    }
    const doc = "outlineDoc" in b ? docOrNull(b.outlineDoc) : snapshot(t).doc;
    const comment = text(b.comment, "Comment") || null;
    // Task type and its fields (field values are merged; null clears one).
    const type = "taskType" in b ? taskType(b.taskType) : taskType(t.task_type);
    assertTaskTypeUsable(type, uid, t.pipe_kind, t.task_type);
    const { values, labels } = "fields" in b ? cleanFields(type, b.fields) : { values: {}, labels: [] };
    const details = {
      ...(type.id !== t.task_type ? { taskType: { from: taskTypeById(t.task_type)?.label ?? t.task_type, to: type.label } } : {}),
      ...(labels.length ? { fields: labels } : {}),
    };

    await tx(async (client) => {
      const row = await one(
        `UPDATE tasks SET title = $2, description = $3, assignee_id = $4, due_date = $5, status = $6, stage = $10,
           outline_doc_id = $7, outline_doc_title = $8, outline_doc_url = $9,
           task_type = $11, fields = jsonb_strip_nulls(fields || $12::jsonb), updated_at = now()
         WHERE id = $1 RETURNING id`,
        [t.id, title, description, assigneeId, dueDate, st, doc?.id ?? null, doc?.title ?? null, doc?.url ?? null, stage,
         type.id, JSON.stringify(values)],
        client
      ).then(() => getTaskRow(t.id, client));
      const before = snapshot(t);
      const after = snapshot(row!);
      const d = Object.keys(details).length ? details : null;
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await recordEvent(client, t.id, uid, before.stage !== after.stage ? "status" : "updated", before, after, comment, d);
      } else if (title !== t.title || description !== t.description) {
        await recordEvent(client, t.id, uid, "edited", before, after, comment, d);
      } else if (d) {
        await recordEvent(client, t.id, uid, "fields", before, after, comment, d);
      } else if (comment) {
        await recordEvent(client, t.id, uid, "comment", before, after, comment);
      }
    });
    return { ok: true };
  });

  app.post("/tasks/:id/move", async (req: Req) => {
    const uid = me(req);
    const { t } = await loadTaskFor(req.params.id, uid, "manage");
    const b = req.body || {};
    const { p } = await loadPipeFor(b.pipeId, uid);
    if (p.archived_at && p.id !== t.pipe_id) throw bad("This pipe is archived");
    assertStaysInSpace(t, p.space_id);
    // Target column: the one asked for, else the one matching the asked status, else the current column
    // when the pipe type stays the same, else the first one matching the current status.
    const wanted = b.stage ?? (b.status === undefined && p.kind === t.pipe_kind ? t.stage : null);
    const c = resolveStage(p.kind, wanted, b.status === undefined ? t.status : status(b.status));
    const comment = text(b.comment, "Comment") || null;
    await tx(async (client) => {
      const position =
        typeof b.position === "number" && Number.isFinite(b.position)
          ? b.position
          : await nextPosition(client, p.space_id, p.id, c.id);
      await client.query(
        `UPDATE tasks SET space_id = $2, pipe_id = $3, status = $4, stage = $7, position = $5, assignee_id = $6, updated_at = now()
         WHERE id = $1`,
        [t.id, p.space_id, p.id, c.status, position, await keptAssignee(p.space_id, t.assignee_id, client), c.id]
      );
      const row = await getTaskRow(t.id, client);
      const before = snapshot(t);
      const after = snapshot(row!);
      if (before.pipe_id !== after.pipe_id || before.stage !== after.stage || comment) {
        const type = !t.pipe_id ? "accepted" : before.pipe_id !== after.pipe_id ? "moved" : "status";
        await recordEvent(client, t.id, uid, type, before, after, comment);
      }
    });
    // Accepted out of an incoming: the other members' counts drop.
    if (!t.pipe_id) notifySpace(t.space_id, { type: "incoming.changed" }, uid);
    return { ok: true };
  });

  app.post("/tasks/:id/send", async (req: Req) => {
    const uid = me(req);
    const { t } = await loadTaskFor(req.params.id, uid, "manage");
    const spaceId = uuid(req.body?.spaceId, "Recipient");
    if (!(await spaceVisible(spaceId, uid))) throw notFound("Recipient not found");
    await assertReachable(spaceId);
    if (spaceId === t.space_id && !t.pipe_id) throw bad("The task is already in this incoming");
    assertStaysInSpace(t, spaceId);
    const comment = text(req.body?.comment, "Comment") || null;
    // Sending to a team may name its owner there; sending to a person makes it theirs.
    const requested = await ensureUser(optUuid(req.body?.assigneeId, "Owner"));
    const assigneeId = requested ? await checkAssignee(spaceId, requested) : await keptAssignee(spaceId, t.assignee_id);
    await tx(async (client) => {
      const position = await nextPosition(client, spaceId, null, null);
      await client.query(
        `UPDATE tasks SET space_id = $2, pipe_id = NULL, stage = NULL, sender_id = $3, position = $4, assignee_id = $5, updated_at = now()
         WHERE id = $1`,
        [t.id, spaceId, uid, position, assigneeId]
      );
      const row = await getTaskRow(t.id, client);
      await recordEvent(client, t.id, uid, "sent", snapshot(t), snapshot(row!), comment);
    });
    notifySpace(spaceId, { type: "task.sent", task: { id: t.id, number: t.number, title: t.title }, by: req.user!.name }, uid);
    // The incoming it left (if any) has one task less.
    if (!t.pipe_id && t.space_id !== spaceId) notifySpace(t.space_id, { type: "incoming.changed" }, uid);
    return { ok: true };
  });

  app.post("/tasks/:id/refuse", async (req: Req) => {
    const uid = me(req);
    const { t, perms } = await loadTaskFor(req.params.id, uid);
    if (!perms.refuse) throw forbidden("Only a task received in your incoming can be refused");
    const reason = text(req.body?.reason, "Reason for refusing", { required: true });
    const target = await personalSpaceId(t.sender_id);
    await tx(async (client) => {
      // Back to the incoming bucket of the person who sent it.
      const position = await nextPosition(client, target, null, null);
      await client.query(
        `UPDATE tasks SET space_id = $2, pipe_id = NULL, stage = NULL, sender_id = $3, position = $4, assignee_id = NULL, updated_at = now()
         WHERE id = $1`,
        [t.id, target, uid, position]
      );
      const row = await getTaskRow(t.id, client);
      await recordEvent(client, t.id, uid, "refused", snapshot(t), snapshot(row!), reason);
    });
    notifySpace(target, { type: "task.refused", task: { id: t.id, number: t.number, title: t.title }, by: req.user!.name, reason }, uid);
    notifySpace(t.space_id, { type: "incoming.changed" }, uid);
    return { ok: true };
  });

  app.post("/tasks/:id/comments", async (req: Req) => {
    const { t } = await loadTaskFor(req.params.id, me(req), "comment");
    const body = text(req.body?.body, "Comment", { required: true });
    await tx(async (client) => {
      const s = snapshot(t);
      await recordEvent(client, t.id, me(req), "comment", s, s, body);
      await client.query(`UPDATE tasks SET updated_at = now() WHERE id = $1`, [t.id]);
    });
    return { ok: true };
  });

  // ----- Reports of a pipe ------------------------------------------------------

  // Activity of a day (from the day before at the report hour); the latest finished day by default.
  app.get("/pipes/:id/reports/daily", async (req: Req) => {
    const { p } = await loadPipeFor(req.params.id, me(req));
    const day = reportDay(req.query.date, latestReportDay());
    return { day, hour: config.reportHour, timezone: config.timezone, ...(await pipeDailyReport(p.id, day)) };
  });

  // Time spent per task type over a week ending on a Friday at the report hour (development pipes).
  app.get("/pipes/:id/reports/weekly", async (req: Req) => {
    const { p } = await loadPipeFor(req.params.id, me(req));
    const day = lastWeekday(reportDay(req.query.date, latestReportWeek()), 5);
    return { day, hour: config.reportHour, timezone: config.timezone, ...(await pipeWeeklyReport(p.id, day)) };
  });

  // ----- Git integrations of a pipe (GitHub / GitLab webhooks) -------------

  const integrationOut = (r: Row) => ({
    provider: r.provider,
    url: `${config.appUrl}/hooks/${r.provider}/${r.token}`,
    secret: decrypt(r.secret),
    createdAt: r.created_at,
    lastEventAt: r.last_event_at,
  });

  /** Only the members of the pipe's space see and manage its connections (they hold secrets). */
  async function pipeForIntegrations(req: Req) {
    const { p, role } = await loadPipeFor(req.params.id, me(req));
    if (!role) throw forbidden();
    return p;
  }

  app.get("/pipes/:id/integrations", async (req: Req) => {
    const p = await pipeForIntegrations(req);
    const { rows } = await query(`SELECT * FROM pipe_integrations WHERE pipe_id = $1 ORDER BY provider`, [p.id]);
    return rows.map(integrationOut);
  });

  // Connects a repository, or renews the secret of a connection.
  app.post("/pipes/:id/integrations", async (req: Req) => {
    const p = await pipeForIntegrations(req);
    const provider = req.body?.provider;
    if (!PROVIDERS.includes(provider)) throw bad("Unknown provider");
    const row = await one(
      `INSERT INTO pipe_integrations (pipe_id, provider, token, secret, created_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (pipe_id, provider) DO UPDATE SET secret = EXCLUDED.secret
       RETURNING *`,
      [p.id, provider, crypto.randomBytes(18).toString("base64url"), encrypt(crypto.randomBytes(24).toString("base64url")), me(req)]
    );
    return integrationOut(row!);
  });

  app.delete("/pipes/:id/integrations/:provider", async (req: Req) => {
    const p = await pipeForIntegrations(req);
    await query(`DELETE FROM pipe_integrations WHERE pipe_id = $1 AND provider = $2`, [p.id, req.params.provider]);
    return { ok: true };
  });

  // ----- Sub-tasks (checklist) ---------------------------------------------

  app.post("/tasks/:id/items", async (req: Req) => {
    const { t } = await loadTaskFor(req.params.id, me(req), "editContent");
    const label = text(req.body?.text, "Sub-task", { required: true, max: 500 });
    const count = await one(`SELECT count(*)::int AS n FROM task_items WHERE task_id = $1`, [t.id]);
    if (count!.n >= MAX_ITEMS) throw bad("{n} sub-tasks at most", { n: MAX_ITEMS });
    const row = await tx(async (client) => {
      const r = await one(
        `INSERT INTO task_items (task_id, text, position)
         VALUES ($1, $2, (SELECT COALESCE(max(position), 0) + 1 FROM task_items WHERE task_id = $1)) RETURNING id`,
        [t.id, label],
        client
      );
      await client.query(`UPDATE tasks SET updated_at = now() WHERE id = $1`, [t.id]);
      return r!;
    });
    return { id: row.id };
  });

  app.patch("/items/:id", async (req: Req) => {
    const uid = me(req);
    const item = await one(`SELECT * FROM task_items WHERE id = $1`, [uuid(req.params.id, "Sub-task")]);
    if (!item) throw notFound("Sub-task not found");
    const { t } = await loadTaskFor(item.task_id, uid, "editContent");
    const b = req.body || {};
    const label = "text" in b ? text(b.text, "Sub-task", { required: true, max: 500 }) : item.text;
    if ("done" in b && typeof b.done !== "boolean") throw bad("Sub-task: invalid state");
    const done = "done" in b ? b.done : item.done;
    if ("position" in b && !Number.isFinite(b.position)) throw bad("Invalid position");
    const position = "position" in b ? b.position : item.position;
    await tx(async (client) => {
      await client.query(
        `UPDATE task_items SET text = $2, done = $3, position = $4,
           done_by = CASE WHEN $3 THEN COALESCE(CASE WHEN done THEN done_by END, $5::uuid) END,
           done_at = CASE WHEN $3 THEN COALESCE(CASE WHEN done THEN done_at END, now()) END
         WHERE id = $1`,
        [item.id, label, done, position, uid]
      );
      await client.query(`UPDATE tasks SET updated_at = now() WHERE id = $1`, [t.id]);
      // Only checking and unchecking show in the history, not edits of the list.
      if (done !== item.done) {
        const s = snapshot(t);
        await recordEvent(client, t.id, uid, "checklist", s, s, null, { item: label, done });
      }
    });
    return { ok: true };
  });

  app.delete("/items/:id", async (req: Req) => {
    const item = await one(`SELECT id, task_id FROM task_items WHERE id = $1`, [uuid(req.params.id, "Sub-task")]);
    if (!item) throw notFound("Sub-task not found");
    await loadTaskFor(item.task_id, me(req), "editContent");
    await query(`DELETE FROM task_items WHERE id = $1`, [item.id]);
    return { ok: true };
  });

  // ----- Files of "files" fields -------------------------------------------

  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_FILE_SIZE }, (_req, body, done) =>
    done(null, body)
  );

  app.post("/tasks/:id/files", { bodyLimit: MAX_FILE_SIZE }, async (req: Req) => {
    const uid = me(req);
    const { t } = await loadTaskFor(req.params.id, uid, "editContent");
    const field = taskType(t.task_type).fields.find((f) => f.id === req.query.field && f.type === "files");
    if (!field) throw bad("This field does not take files");
    const content = req.body as unknown as Buffer;
    if (!Buffer.isBuffer(content) || !content.length) throw bad("Empty file");
    const name = text(decodeURIComponent(String(req.headers["x-file-name"] || "")), "File name", { required: true, max: 255 });
    const mime = String(req.headers["x-file-type"] || "application/octet-stream").slice(0, 120);
    const id = await tx(async (client) => {
      const row = await one(
        `INSERT INTO task_files (task_id, field, name, mime, size, content, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [t.id, field.id, name, mime, content.length, content, uid],
        client
      );
      const s = snapshot(t);
      await recordEvent(client, t.id, uid, "file", s, s, null, { added: name, field: field.label });
      await client.query(`UPDATE tasks SET updated_at = now() WHERE id = $1`, [t.id]);
      return row!.id as string;
    });
    return { id };
  });

  app.get("/files/:id", async (req: Req, reply) => {
    const f = await one(`SELECT * FROM task_files WHERE id = $1`, [uuid(req.params.id, "File")]);
    if (!f) throw notFound("File not found");
    await loadTaskFor(f.task_id, me(req));
    // Images and PDFs open in the browser; everything else is downloaded.
    const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(f.mime) && req.query.download === undefined;
    return reply
      .header("Content-Type", f.mime)
      .header("Content-Length", f.size)
      .header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "sandbox")
      .header("Cache-Control", "private, max-age=3600")
      .send(f.content);
  });

  app.delete("/files/:id", async (req: Req) => {
    const uid = me(req);
    const f = await one(`SELECT id, task_id, name, field FROM task_files WHERE id = $1`, [uuid(req.params.id, "File")]);
    if (!f) throw notFound("File not found");
    const { t } = await loadTaskFor(f.task_id, uid, "editContent");
    const label = taskType(t.task_type).fields.find((x) => x.id === f.field)?.label ?? f.field;
    await tx(async (client) => {
      await client.query(`DELETE FROM task_files WHERE id = $1`, [f.id]);
      const s = snapshot(t);
      await recordEvent(client, t.id, uid, "file", s, s, null, { removed: f.name, field: label });
    });
    return { ok: true };
  });

  // ----- Outline documents --------------------------------------------------

  app.get("/outline/documents", async (req: Req) => {
    const q = String(req.query.q || "").trim();
    if (!q) {
      const { data } = await req.outline<OutlineDocument[]>("documents.list", { limit: 15, sort: "updatedAt", direction: "DESC" });
      return data.map((d) => presentDoc(d, req.outlineUrl));
    }
    // A pasted Outline document URL is resolved directly.
    const m = q.match(/\/doc\/([^/?#]+)/);
    if (m) {
      const { data } = await req.outline<OutlineDocument>("documents.info", { id: m[1] });
      return [presentDoc(data, req.outlineUrl)];
    }
    const { data } = await req.outline<{ document: OutlineDocument }[]>("documents.search", { query: q, limit: 15 });
    return data.map((r) => presentDoc(r.document, req.outlineUrl));
  });

  app.get("/outline/collections", async (req) => {
    const { data } = await req.outline<{ id: string; name: string }[]>("collections.list", { limit: 100 });
    return data.map((c) => ({ id: c.id, name: c.name }));
  });

  app.post("/tasks/:id/outline-document", async (req: Req) => {
    const uid = me(req);
    const { t } = await loadTaskFor(req.params.id, uid, "manage");
    const collectionId = text(req.body?.collectionId, "Collection", { required: true, max: 100 });
    const { data } = await req.outline<OutlineDocument>("documents.create", {
      title: t.title,
      text: `${t.description || ""}\n\n---\n[${tr(localeOf(req), "TasksPipes task #{n}", { n: t.number })}](${config.appUrl}/?task=${t.id})`,
      collectionId,
      publish: true,
    });
    const doc = presentDoc(data, req.outlineUrl);
    await tx(async (client) => {
      const row = await one(
        `UPDATE tasks SET outline_doc_id = $2, outline_doc_title = $3, outline_doc_url = $4, updated_at = now()
         WHERE id = $1 RETURNING id`,
        [t.id, doc.id, doc.title, doc.url],
        client
      ).then(() => getTaskRow(t.id, client));
      await recordEvent(client, t.id, uid, "updated", snapshot(t), snapshot(row!), null);
    });
    return doc;
  });
}

// ---------------------------------------------------------------------------
// Git webhooks (outside /api: GitHub and GitLab call them without a session)

/** System accounts recorded as the authors of the moves made by GitHub and GitLab. */
const BOT: Record<Provider, string> = {
  github: "00000000-0000-4000-8000-0000000000a1",
  gitlab: "00000000-0000-4000-8000-0000000000a2",
};

/** Links pull/merge requests and commits to the tasks of a pipe they name, and moves those tasks. */
export async function applyGitItems(pipeId: string, provider: Provider, items: GitItem[]) {
  let linked = 0;
  let moved = 0;
  for (const item of items) {
    for (const number of item.keys) {
      const t = await one(`${TASK_SELECT} WHERE t.number = $1 AND t.pipe_id = $2`, [number, pipeId]);
      if (!t) continue;
      const { link } = item;
      const details = { provider, kind: link.kind, url: link.url, number: link.number, title: link.title, repo: link.repo, action: item.action };
      await tx(async (client) => {
        const known = await one(`SELECT id FROM task_links WHERE task_id = $1 AND url = $2`, [t.id, link.url], client);
        await client.query(
          `INSERT INTO task_links (task_id, provider, kind, url, number, title, state, repo, author)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (task_id, url) DO UPDATE SET title = EXCLUDED.title, state = EXCLUDED.state, updated_at = now()`,
          [t.id, provider, link.kind, link.url, link.number, link.title, link.state, link.repo, link.author]
        );
        const before = snapshot(t);
        if (!known) {
          await recordEvent(client, t.id, BOT[provider], "linked", before, before, null, details);
          linked++;
        }
        // A dropped task stays where it is.
        if (item.move && t.status !== "abandoned") {
          const c = resolveStage(t.pipe_kind, null, item.move);
          if (c.id !== t.stage) {
            await client.query(`UPDATE tasks SET stage = $2, status = $3, updated_at = now() WHERE id = $1`, [t.id, c.id, c.status]);
            const row = await getTaskRow(t.id, client);
            await recordEvent(client, t.id, BOT[provider], "status", before, snapshot(row!), null, details);
            moved++;
          }
        }
      });
      notifySpace(t.space_id, { type: "task.updated" });
    }
  }
  return { linked, moved };
}

export async function gitWebhooks(app: FastifyInstance) {
  // The signature covers the raw body: keep it as it came.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 10 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.post<{ Params: { provider: string; token: string } }>("/hooks/:provider/:token", rateLimited(LIMITS.webhook), async (req, reply) => {
    const provider = req.params.provider as Provider;
    if (!PROVIDERS.includes(provider)) return reply.code(404).send({ error: "Not found" });
    const integ = await one(`SELECT id, pipe_id, secret FROM pipe_integrations WHERE provider = $1 AND token = $2`, [provider, req.params.token]);
    if (!integ) return reply.code(404).send({ error: "Not found" });
    const body = req.body as Buffer;
    const secret = decrypt(integ.secret)!;
    const ok =
      provider === "github"
        ? verifyGithub(secret, body, req.headers["x-hub-signature-256"] as string | undefined)
        : verifyGitlab(secret, req.headers["x-gitlab-token"] as string | undefined);
    if (!ok) return reply.code(401).send({ error: "Invalid signature" });

    let payload: unknown;
    try {
      const text = body.toString("utf8");
      // GitHub can also send form-encoded payloads.
      payload = JSON.parse(String(req.headers["content-type"]).includes("form") ? new URLSearchParams(text).get("payload") ?? "" : text);
    } catch {
      return reply.code(400).send({ error: "Invalid payload" });
    }
    await query(`UPDATE pipe_integrations SET last_event_at = now() WHERE id = $1`, [integ.id]);
    const event = (provider === "github" ? req.headers["x-github-event"] : req.headers["x-gitlab-event"]) as string | undefined;
    if (event === "ping") return { ok: true };
    return { ok: true, ...(await applyGitItems(integ.pipe_id, provider, gitItems(provider, event, payload))) };
  });
}
