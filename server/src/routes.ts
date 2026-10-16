import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { one, query, tx, type Queryable, type Row } from "./db.js";
import { absoluteOutlineUrl, type OutlineDocument } from "./outline.js";
import { HttpError, bad, forbidden, notFound } from "./errors.js";
import { DEFAULT_PIPE_TYPE, PIPE_TYPES, pipeTypeById } from "./pipeTypes.js";

export const STATUSES = ["backlog", "ready", "started", "ongoing", "blocked", "abandoned", "done"] as const;
type Status = (typeof STATUSES)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
type Req = FastifyRequest<{ Params: Record<string, string>; Body: Body; Querystring: Record<string, string> }>;

// ---------------------------------------------------------------------------
// Input helpers

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw bad(`${label} invalide`);
  return value;
}
const optUuid = (value: unknown, label: string) =>
  value === null || value === undefined || value === "" ? null : uuid(value, label);

function text(value: unknown, label: string, { required = false, max = 100_000 } = {}): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (required && !v) throw bad(`${label} requis`);
  if (v.length > max) throw bad(`${label} trop long`);
  return v;
}

function dateOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad("Date d'échéance invalide");
  return value;
}

function status(value: unknown, fallback: Status = "backlog"): Status {
  if (value === undefined || value === null) return fallback;
  if (!STATUSES.includes(value as Status)) throw bad("Statut invalide");
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
  if (typeof d.id !== "string" || !d.id) throw bad("Document Outline invalide");
  return {
    id: d.id.slice(0, 200),
    title: String(d.title || "Sans titre").slice(0, 500),
    url: absoluteOutlineUrl(String(d.url || "")),
  };
}

const color = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 20) : null);
const icon = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 32) : null);

function pipeKind(value: unknown): string {
  if (value === undefined || value === null || value === "") return DEFAULT_PIPE_TYPE;
  if (!pipeTypeById(value)) throw bad("Type de pipe invalide");
  return value as string;
}

// ---------------------------------------------------------------------------
// Data access helpers

const SPACE_NAME = `COALESCE(su.name, s.name)`;

async function memberRole(spaceId: string, userId: string, db?: Queryable): Promise<string | null> {
  const r = await one(`SELECT role FROM space_members WHERE space_id = $1 AND user_id = $2`, [spaceId, userId], db);
  return r?.role ?? null;
}

function getSpace(id: string, userId: string) {
  return one(
    `SELECT s.id, s.kind, s.user_id, ${SPACE_NAME} AS name, s.description, s.color,
            su.avatar_url, s.created_at, m.role AS my_role
     FROM spaces s
     LEFT JOIN users su ON su.id = s.user_id
     LEFT JOIN space_members m ON m.space_id = s.id AND m.user_id = $2
     WHERE s.id = $1`,
    [id, userId]
  );
}

const personalSpaceId = async (userId: string, db?: Queryable): Promise<string> =>
  (await one(`SELECT id FROM spaces WHERE user_id = $1`, [userId], db))?.id;

const TASK_SELECT = `
  SELECT t.*, p.name AS pipe_name, p.visibility AS pipe_visibility,
         ${SPACE_NAME} AS space_name, s.kind AS space_kind, s.user_id AS space_user_id, su.avatar_url AS space_user_avatar,
         au.name AS author_name, au.avatar_url AS author_avatar,
         asg.name AS assignee_name, asg.avatar_url AS assignee_avatar,
         se.name AS sender_name, se.avatar_url AS sender_avatar,
         (SELECT count(*) FROM task_events e WHERE e.task_id = t.id AND e.type = 'comment') AS comment_count
  FROM tasks t
  JOIN spaces s ON s.id = t.space_id
  LEFT JOIN users su ON su.id = s.user_id
  LEFT JOIN pipes p ON p.id = t.pipe_id
  JOIN users au ON au.id = t.author_id
  LEFT JOIN users asg ON asg.id = t.assignee_id
  LEFT JOIN users se ON se.id = t.sender_id`;

function presentTask(t: Row) {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    description: t.description,
    status: t.status,
    position: t.position,
    dueDate: t.due_date,
    space: { id: t.space_id, name: t.space_name, kind: t.space_kind },
    pipe: t.pipe_id ? { id: t.pipe_id, name: t.pipe_name, visibility: t.pipe_visibility } : null,
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

const getTaskRow = (id: string, db?: Queryable) => one(`${TASK_SELECT} WHERE t.id = $1`, [id], db);

interface TaskPermissions {
  view: boolean;
  manage: boolean;
  editContent: boolean;
  comment: boolean;
  refuse: boolean;
}

async function taskPermissions(t: Row, userId: string): Promise<TaskPermissions> {
  const isMember = Boolean(await memberRole(t.space_id, userId));
  const openPipe = t.pipe_visibility === "open";
  const involved = t.author_id === userId || t.sender_id === userId;
  return {
    view: isMember || openPipe || involved,
    manage: isMember,
    editContent: isMember || (t.author_id === userId && openPipe),
    comment: isMember || openPipe || involved,
    // A task can be refused only from an incoming bucket, and only if someone else sent it.
    refuse: isMember && !t.pipe_id && Boolean(t.sender_id) && t.sender_id !== userId,
  };
}

async function loadTaskFor(id: string, userId: string, need?: keyof TaskPermissions) {
  const t = await getTaskRow(uuid(id, "Tâche"));
  if (!t) throw notFound("Tâche introuvable");
  const perms = await taskPermissions(t, userId);
  if (!perms.view) throw notFound("Tâche introuvable");
  if (need && !perms[need]) throw forbidden();
  return { t, perms };
}

async function loadPipeFor(id: unknown, userId: string) {
  const p = await one(
    `SELECT p.*, u.name AS created_by_name FROM pipes p LEFT JOIN users u ON u.id = p.created_by WHERE p.id = $1`,
    [uuid(id, "Pipe")]
  );
  if (!p) throw notFound("Pipe introuvable");
  const role = await memberRole(p.space_id, userId);
  if (!role && p.visibility !== "open") throw notFound("Pipe introuvable");
  return { p, role };
}

interface Snapshot {
  space_id: string;
  pipe_id: string | null;
  status: Status;
  assignee_id: string | null;
  due_date: string | null;
  doc: DocRef | null;
}

const snapshot = (t: Row): Snapshot => ({
  space_id: t.space_id,
  pipe_id: t.pipe_id,
  status: t.status,
  assignee_id: t.space_user_id ?? t.assignee_id,
  due_date: t.due_date,
  doc: t.outline_doc_id ? { id: t.outline_doc_id, title: t.outline_doc_title, url: t.outline_doc_url } : null,
});

/** Writes one entry of a task's history, with the state before and after the change. */
async function recordEvent(
  db: Queryable,
  taskId: string,
  actorId: string,
  type: string,
  before: Snapshot | null,
  after: Snapshot,
  comment: string | null = null
) {
  await db.query(
    `INSERT INTO task_events (task_id, actor_id, type, comment,
       from_space_id, to_space_id, from_pipe_id, to_pipe_id, from_status, to_status,
       from_assignee_id, to_assignee_id, from_due_date, to_due_date, from_doc, to_doc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      taskId, actorId, type, comment || null,
      before?.space_id ?? null, after.space_id,
      before?.pipe_id ?? null, after.pipe_id,
      before?.status ?? null, after.status,
      before?.assignee_id ?? null, after.assignee_id,
      before?.due_date ?? null, after.due_date,
      before?.doc ? JSON.stringify(before.doc) : null,
      after.doc ? JSON.stringify(after.doc) : null,
    ]
  );
}

async function nextPosition(db: Queryable, spaceId: string, pipeId: string | null, st: Status): Promise<number> {
  const r = pipeId
    ? await one(`SELECT COALESCE(max(position), 0) + 1 AS p FROM tasks WHERE pipe_id = $1 AND status = $2`, [pipeId, st], db)
    : await one(`SELECT COALESCE(max(position), 0) + 1 AS p FROM tasks WHERE space_id = $1 AND pipe_id IS NULL`, [spaceId], db);
  return r!.p;
}

async function getEvents(taskId: string) {
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
    assignee: e[`${p}_assignee_id`] ? { id: e[`${p}_assignee_id`], name: e[`${p}_assignee_name`] } : null,
    dueDate: e[`${p}_due_date`],
    doc: e[`${p}_doc`],
  });
  return rows.map((e) => ({
    id: e.id,
    type: e.type,
    comment: e.comment,
    createdAt: e.created_at,
    actor: { id: e.actor_id, name: e.actor_name, avatarUrl: e.actor_avatar },
    from: side(e, "from"),
    to: side(e, "to"),
  }));
}

async function ensureUser(id: string | null, db?: Queryable): Promise<string | null> {
  if (!id) return null;
  if (!(await one(`SELECT id FROM users WHERE id = $1`, [uuid(id, "Utilisateur")], db))) throw bad("Utilisateur inconnu");
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
  if (!assigneeId || (await keptAssignee(spaceId, assigneeId, db))) return assigneeId;
  const s = await one(`SELECT kind FROM spaces WHERE id = $1`, [spaceId], db);
  throw bad(
    s?.kind === "team"
      ? "Le ou la propriétaire doit être membre de l'équipe"
      : "Une tâche d'un espace personnel appartient à sa ou son titulaire : envoyez-la plutôt à quelqu'un."
  );
}

async function requireTeamAdmin(spaceId: string, userId: string) {
  const s = await getSpace(uuid(spaceId, "Espace"), userId);
  if (!s) throw notFound("Espace introuvable");
  if (s.kind !== "team") throw bad("Les espaces personnels ne peuvent pas être modifiés");
  if (s.my_role !== "admin") throw forbidden("Seuls les administrateurs de l'équipe peuvent faire cela");
  return s;
}

async function assertAdminRemains(db: Queryable, spaceId: string) {
  const r = await one(`SELECT count(*) AS n FROM space_members WHERE space_id = $1 AND role = 'admin'`, [spaceId], db);
  if (r!.n < 1) throw bad("L'équipe doit garder au moins un administrateur");
}

const presentDoc = (d: OutlineDocument) => ({
  id: d.id,
  title: d.title || "Sans titre",
  url: absoluteOutlineUrl(d.url),
  updatedAt: d.updatedAt,
  collectionId: d.collectionId,
});

// ---------------------------------------------------------------------------
// Routes (mounted under /api, all require a session)

export async function apiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => {
    if (!req.user) throw new HttpError(401, "Non authentifié");
  });
  const me = (req: FastifyRequest) => req.user!.id;

  app.get("/me", async (req) => ({
    user: req.user,
    personalSpaceId: await personalSpaceId(me(req)),
    outlineUrl: config.outlineUrl,
  }));

  app.get("/users", async () => {
    const { rows } = await query(
      `SELECT u.id, u.name, u.avatar_url, u.last_login_at, s.id AS space_id
       FROM users u LEFT JOIN spaces s ON s.user_id = u.id ORDER BY lower(u.name)`
    );
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      avatarUrl: u.avatar_url,
      spaceId: u.space_id,
      active: Boolean(u.last_login_at),
    }));
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

  // ----- Spaces -------------------------------------------------------------

  app.get("/spaces", async (req) => {
    const { rows } = await query(
      `SELECT s.id, s.kind, s.user_id, ${SPACE_NAME} AS name, s.description, s.color, su.avatar_url,
              su.last_login_at, m.role AS my_role,
              (SELECT count(*) FROM space_members sm WHERE sm.space_id = s.id) AS member_count,
              CASE WHEN m.role IS NOT NULL THEN
                (SELECT count(*) FROM tasks t WHERE t.space_id = s.id AND t.pipe_id IS NULL) END AS incoming_count,
              (SELECT count(*) FROM pipes p WHERE p.space_id = s.id AND p.archived_at IS NULL
                 AND (p.visibility = 'open' OR m.role IS NOT NULL)) AS pipe_count
       FROM spaces s
       LEFT JOIN users su ON su.id = s.user_id
       LEFT JOIN space_members m ON m.space_id = s.id AND m.user_id = $1
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
      myRole: s.my_role,
      memberCount: s.member_count,
      incomingCount: s.incoming_count,
      pipeCount: s.pipe_count,
    }));
  });

  app.post("/spaces", async (req: Req) => {
    const uid = me(req);
    const name = text(req.body?.name, "Nom", { required: true, max: 120 });
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
    const s = await getSpace(uuid(req.params.id, "Espace"), me(req));
    if (!s) throw notFound("Espace introuvable");
    const isMember = Boolean(s.my_role);
    const [members, pipes, incoming] = await Promise.all([
      query(
        `SELECT u.id, u.name, u.avatar_url, m.role FROM space_members m JOIN users u ON u.id = m.user_id
         WHERE m.space_id = $1 ORDER BY m.role, lower(u.name)`,
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
      members: members.rows.map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatar_url, role: m.role })),
      pipes: pipes.rows.map(presentPipe),
      incoming: incoming ? incoming.rows.map(presentTask) : null,
    };
  });

  app.patch("/spaces/:id", async (req: Req) => {
    const s = await requireTeamAdmin(req.params.id, me(req));
    const b = req.body || {};
    await query(`UPDATE spaces SET name = $2, description = $3, color = $4 WHERE id = $1`, [
      s.id,
      "name" in b ? text(b.name, "Nom", { required: true, max: 120 }) : s.name,
      "description" in b ? text(b.description, "Description") : s.description,
      "color" in b ? color(b.color) : s.color,
    ]);
    return { ok: true };
  });

  app.delete("/spaces/:id", async (req: Req) => {
    const s = await requireTeamAdmin(req.params.id, me(req));
    const n = await one(`SELECT count(*) AS n FROM tasks WHERE space_id = $1`, [s.id]);
    if (n!.n > 0) throw bad("L'équipe contient encore des tâches : déplacez-les ou envoyez-les avant de la supprimer.");
    await query(`DELETE FROM spaces WHERE id = $1`, [s.id]);
    return { ok: true };
  });

  app.post("/spaces/:id/members", async (req: Req) => {
    const s = await requireTeamAdmin(req.params.id, me(req));
    const userId = await ensureUser(optUuid(req.body?.userId, "Utilisateur"));
    if (!userId) throw bad("Utilisateur requis");
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
        uuid(req.params.userId, "Utilisateur"),
        role,
      ]);
      await assertAdminRemains(client, s.id);
    });
    return { ok: true };
  });

  app.delete("/spaces/:id/members/:userId", async (req: Req) => {
    const spaceId = uuid(req.params.id, "Espace");
    const userId = uuid(req.params.userId, "Utilisateur");
    if (userId !== me(req)) await requireTeamAdmin(spaceId, me(req));
    else {
      const s = await getSpace(spaceId, me(req));
      if (!s || s.kind !== "team") throw bad("Impossible de quitter cet espace");
    }
    await tx(async (client) => {
      await client.query(`DELETE FROM space_members WHERE space_id = $1 AND user_id = $2`, [spaceId, userId]);
      await assertAdminRemains(client, spaceId);
    });
    return { ok: true };
  });

  // ----- Pipes --------------------------------------------------------------

  app.get("/pipe-types", async () => PIPE_TYPES);

  // Sidebar: my personal pipes, and the pipes I pinned that I can still see.
  app.get("/sidebar", async (req) => {
    const uid = me(req);
    const [mine, pinned] = await Promise.all([
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
         WHERE pp.user_id = $1 AND p.archived_at IS NULL
           AND (p.visibility = 'open' OR EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = p.space_id AND m.user_id = $1))
         ORDER BY pp.created_at`,
        [uid]
      ),
    ]);
    return {
      mine: mine.rows.map((p) => ({ ...presentPipe(p), canManage: true })),
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
    const spaceId = uuid(req.params.id, "Espace");
    if (!(await memberRole(spaceId, uid))) throw forbidden();
    const kind = pipeKind(req.body?.kind);
    const id = await tx(async (client) => {
      const row = await one(
        `INSERT INTO pipes (space_id, name, description, visibility, kind, color, icon, created_by, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT COALESCE(max(position), 0) + 1 FROM pipes WHERE space_id = $1))
         RETURNING id`,
        [
          spaceId,
          text(req.body?.name, "Nom", { required: true, max: 120 }),
          text(req.body?.description, "Description"),
          req.body?.visibility === "open" ? "open" : "private",
          kind,
          color(req.body?.color),
          icon(req.body?.icon),
          uid,
        ],
        client
      );
      // Starter tasks of a process type, in the backlog.
      if (req.body?.withTemplates) {
        for (const [i, title] of pipeTypeById(kind)!.templates.entries()) {
          const { rows } = await client.query(
            `INSERT INTO tasks (title, space_id, pipe_id, status, position, author_id)
             VALUES ($1, $2, $3, 'backlog', $4, $5) RETURNING id`,
            [title, spaceId, row!.id, i + 1, uid]
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

  app.patch("/pipes/:id", async (req: Req) => {
    const { p, role } = await loadPipeFor(req.params.id, me(req));
    if (!role) throw forbidden();
    const b = req.body || {};
    if (b.archived && !p.archived_at) {
      if (p.is_default) throw bad("Le pipe par défaut de l'espace personnel ne peut pas être archivé");
      // Like a task, a pipe is closed once its work is over: no task left in progress.
      const open = await one(`SELECT count(*) AS n FROM tasks WHERE pipe_id = $1 AND status NOT IN ('done','abandoned')`, [p.id]);
      if (open!.n > 0) {
        throw bad(`Ce pipe a encore ${open!.n} tâche${open!.n > 1 ? "s" : ""} en cours : terminez-les, abandonnez-les ou déplacez-les avant de l'archiver.`);
      }
    }
    await query(
      `UPDATE pipes SET name = $2, description = $3, visibility = $4, color = $5, kind = $6, icon = $8,
         archived_at = CASE WHEN $7::boolean IS NULL THEN archived_at WHEN $7 THEN COALESCE(archived_at, now()) END,
         updated_at = now()
       WHERE id = $1`,
      [
        p.id,
        "name" in b ? text(b.name, "Nom", { required: true, max: 120 }) : p.name,
        "description" in b ? text(b.description, "Description") : p.description,
        "visibility" in b ? (b.visibility === "open" ? "open" : "private") : p.visibility,
        "color" in b ? color(b.color) : p.color,
        "kind" in b ? pipeKind(b.kind) : p.kind,
        "archived" in b ? Boolean(b.archived) : null,
        "icon" in b ? icon(b.icon) : p.icon,
      ]
    );
    return { ok: true };
  });

  app.delete("/pipes/:id", async (req: Req) => {
    const { p, role } = await loadPipeFor(req.params.id, me(req));
    if (!role) throw forbidden();
    if (p.is_default) throw bad("Le pipe par défaut de l'espace personnel ne peut pas être supprimé");
    const n = await one(`SELECT count(*) AS n FROM tasks WHERE pipe_id = $1`, [p.id]);
    if (n!.n > 0) throw bad("Ce pipe contient encore des tâches : déplacez-les avant de le supprimer.");
    await query(`DELETE FROM pipes WHERE id = $1`, [p.id]);
    return { ok: true };
  });

  // ----- Tasks --------------------------------------------------------------

  app.post("/tasks", async (req: Req) => {
    const uid = me(req);
    const b = req.body || {};
    const title = text(b.title, "Titre", { required: true, max: 300 });
    const description = text(b.description, "Description");
    const dueDate = dateOrNull(b.dueDate);
    const doc = docOrNull(b.outlineDoc);
    const comment = text(b.comment, "Commentaire") || null;
    const st = status(b.status);

    let spaceId: string;
    let pipeId: string | null = null;
    let senderId: string | null = null;
    if (b.pipeId) {
      // Creating straight into a pipe: own pipe, or someone else's open pipe.
      const { p } = await loadPipeFor(b.pipeId, uid);
      if (p.archived_at) throw bad("Ce pipe est archivé");
      spaceId = p.space_id;
      pipeId = p.id;
    } else {
      // Otherwise the task is sent to a space's incoming bucket.
      spaceId = uuid(b.spaceId, "Espace");
      if (!(await one(`SELECT id FROM spaces WHERE id = $1`, [spaceId]))) throw notFound("Espace introuvable");
      senderId = uid;
    }
    const assigneeId = await checkAssignee(spaceId, await ensureUser(optUuid(b.assigneeId, "Propriétaire")));

    const id = await tx(async (client) => {
      const position = await nextPosition(client, spaceId, pipeId, st);
      const row = await one(
        `INSERT INTO tasks (title, description, space_id, pipe_id, status, position, assignee_id, due_date,
                            outline_doc_id, outline_doc_title, outline_doc_url, author_id, sender_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [title, description, spaceId, pipeId, st, position, assigneeId, dueDate,
         doc?.id ?? null, doc?.title ?? null, doc?.url ?? null, uid, senderId],
        client
      ).then((r) => getTaskRow(r!.id, client));
      await recordEvent(client, row!.id, uid, pipeId ? "created" : "sent", null, snapshot(row!), comment);
      return row!.id as string;
    });
    return { id };
  });

  app.get("/tasks/:id", async (req: Req) => {
    const { t, perms } = await loadTaskFor(req.params.id, me(req));
    return { ...presentTask(t), permissions: perms, events: await getEvents(t.id) };
  });

  app.patch("/tasks/:id", async (req: Req) => {
    const uid = me(req);
    const { t, perms } = await loadTaskFor(req.params.id, uid, "editContent");
    const b = req.body || {};
    if (["assigneeId", "dueDate", "outlineDoc", "status"].some((k) => k in b) && !perms.manage) throw forbidden();

    const title = "title" in b ? text(b.title, "Titre", { required: true, max: 300 }) : t.title;
    const description = "description" in b ? text(b.description, "Description") : t.description;
    const assigneeId =
      "assigneeId" in b ? await checkAssignee(t.space_id, await ensureUser(optUuid(b.assigneeId, "Propriétaire"))) : t.assignee_id;
    const dueDate = "dueDate" in b ? dateOrNull(b.dueDate) : t.due_date;
    const st = "status" in b ? status(b.status) : t.status;
    const doc = "outlineDoc" in b ? docOrNull(b.outlineDoc) : snapshot(t).doc;
    const comment = text(b.comment, "Commentaire") || null;

    await tx(async (client) => {
      const row = await one(
        `UPDATE tasks SET title = $2, description = $3, assignee_id = $4, due_date = $5, status = $6,
           outline_doc_id = $7, outline_doc_title = $8, outline_doc_url = $9, updated_at = now()
         WHERE id = $1 RETURNING id`,
        [t.id, title, description, assigneeId, dueDate, st, doc?.id ?? null, doc?.title ?? null, doc?.url ?? null],
        client
      ).then(() => getTaskRow(t.id, client));
      const before = snapshot(t);
      const after = snapshot(row!);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await recordEvent(client, t.id, uid, before.status !== after.status ? "status" : "updated", before, after, comment);
      } else if (title !== t.title || description !== t.description) {
        await recordEvent(client, t.id, uid, "edited", before, after, comment);
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
    if (p.archived_at && p.id !== t.pipe_id) throw bad("Ce pipe est archivé");
    const st = status(b.status, t.status);
    const comment = text(b.comment, "Commentaire") || null;
    await tx(async (client) => {
      const position =
        typeof b.position === "number" && Number.isFinite(b.position)
          ? b.position
          : await nextPosition(client, p.space_id, p.id, st);
      await client.query(
        `UPDATE tasks SET space_id = $2, pipe_id = $3, status = $4, position = $5, assignee_id = $6, updated_at = now()
         WHERE id = $1`,
        [t.id, p.space_id, p.id, st, position, await keptAssignee(p.space_id, t.assignee_id, client)]
      );
      const row = await getTaskRow(t.id, client);
      const before = snapshot(t);
      const after = snapshot(row!);
      if (before.pipe_id !== after.pipe_id || before.status !== after.status || comment) {
        const type = !t.pipe_id ? "accepted" : before.pipe_id !== after.pipe_id ? "moved" : "status";
        await recordEvent(client, t.id, uid, type, before, after, comment);
      }
    });
    return { ok: true };
  });

  app.post("/tasks/:id/send", async (req: Req) => {
    const uid = me(req);
    const { t } = await loadTaskFor(req.params.id, uid, "manage");
    const spaceId = uuid(req.body?.spaceId, "Destinataire");
    if (!(await one(`SELECT id FROM spaces WHERE id = $1`, [spaceId]))) throw notFound("Destinataire introuvable");
    if (spaceId === t.space_id && !t.pipe_id) throw bad("La tâche est déjà dans cet incoming");
    const comment = text(req.body?.comment, "Commentaire") || null;
    // Sending to a team may name its owner there; sending to a person makes it theirs.
    const requested = await ensureUser(optUuid(req.body?.assigneeId, "Propriétaire"));
    const assigneeId = requested ? await checkAssignee(spaceId, requested) : await keptAssignee(spaceId, t.assignee_id);
    await tx(async (client) => {
      const position = await nextPosition(client, spaceId, null, t.status);
      await client.query(
        `UPDATE tasks SET space_id = $2, pipe_id = NULL, sender_id = $3, position = $4, assignee_id = $5, updated_at = now()
         WHERE id = $1`,
        [t.id, spaceId, uid, position, assigneeId]
      );
      const row = await getTaskRow(t.id, client);
      await recordEvent(client, t.id, uid, "sent", snapshot(t), snapshot(row!), comment);
    });
    return { ok: true };
  });

  app.post("/tasks/:id/refuse", async (req: Req) => {
    const uid = me(req);
    const { t, perms } = await loadTaskFor(req.params.id, uid);
    if (!perms.refuse) throw forbidden("Seule une tâche reçue dans votre incoming peut être refusée");
    const reason = text(req.body?.reason, "Raison du refus", { required: true });
    await tx(async (client) => {
      // Back to the incoming bucket of the person who sent it.
      const target = await personalSpaceId(t.sender_id, client);
      const position = await nextPosition(client, target, null, t.status);
      await client.query(
        `UPDATE tasks SET space_id = $2, pipe_id = NULL, sender_id = $3, position = $4, assignee_id = NULL, updated_at = now()
         WHERE id = $1`,
        [t.id, target, uid, position]
      );
      const row = await getTaskRow(t.id, client);
      await recordEvent(client, t.id, uid, "refused", snapshot(t), snapshot(row!), reason);
    });
    return { ok: true };
  });

  app.post("/tasks/:id/comments", async (req: Req) => {
    const { t } = await loadTaskFor(req.params.id, me(req), "comment");
    const body = text(req.body?.body, "Commentaire", { required: true });
    await tx(async (client) => {
      const s = snapshot(t);
      await recordEvent(client, t.id, me(req), "comment", s, s, body);
      await client.query(`UPDATE tasks SET updated_at = now() WHERE id = $1`, [t.id]);
    });
    return { ok: true };
  });

  // ----- Outline documents --------------------------------------------------

  app.get("/outline/documents", async (req: Req) => {
    const q = String(req.query.q || "").trim();
    if (!q) {
      const { data } = await req.outline<OutlineDocument[]>("documents.list", { limit: 15, sort: "updatedAt", direction: "DESC" });
      return data.map(presentDoc);
    }
    // A pasted Outline document URL is resolved directly.
    const m = q.match(/\/doc\/([^/?#]+)/);
    if (m) {
      const { data } = await req.outline<OutlineDocument>("documents.info", { id: m[1] });
      return [presentDoc(data)];
    }
    const { data } = await req.outline<{ document: OutlineDocument }[]>("documents.search", { query: q, limit: 15 });
    return data.map((r) => presentDoc(r.document));
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
      text: `${t.description || ""}\n\n---\n[Tâche TasksPipes #${t.number}](${config.appUrl}/?task=${t.id})`,
      collectionId,
      publish: true,
    });
    const doc = presentDoc(data);
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
