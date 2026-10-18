/**
 * Labels and priority, for every task. Labels belong to a space (personal or team): its members manage them and
 * put them on its tasks, as they edit fields (the author of a task in an open pipe too). Whoever can see the space
 * sees its labels; a task leaving the space loses them. Priority: 1 urgent, 2 high, 3 medium, 4 low, or none.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { one, query, type Queryable, type Row } from "./db.js";
import { bad, forbidden, notFound } from "./errors.js";
import { memberRole, spaceVisible } from "./access.js";

export const PRIORITIES = [1, 2, 3, 4] as const;
export const MAX_LABELS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;

/** A priority from a request: 1 to 4, or null for none. */
export function cleanPriority(v: unknown): number | null {
  if (v === null || v === "" || v === undefined) return null;
  if (!PRIORITIES.includes(v as 1)) throw bad("Invalid priority");
  return v as number;
}

export const presentLabel = (l: Row) => ({ id: l.id, name: l.name, color: l.color, position: l.position });

/** Label ids from a request, all of the space `spaceId`; each once. */
export async function cleanLabelIds(v: unknown, spaceId: string, db?: Queryable): Promise<string[]> {
  if (!Array.isArray(v) || v.length > MAX_LABELS || !v.every((x) => typeof x === "string" && UUID.test(x))) throw bad("Invalid label");
  const ids = [...new Set(v.map((x: string) => x.toLowerCase()))];
  if (!ids.length) return [];
  const { rows } = await query(`SELECT id FROM space_labels WHERE space_id = $1 AND id = ANY($2::uuid[])`, [spaceId, ids], db);
  if (rows.length !== ids.length) throw bad("Invalid label");
  return ids;
}

/** Sets the labels of a task; returns the names added and removed (for its history). */
export async function setTaskLabels(db: Queryable, taskId: string, ids: string[]) {
  const { rows: before } = await db.query(
    `SELECT l.id, l.name FROM task_labels tl JOIN space_labels l ON l.id = tl.label_id WHERE tl.task_id = $1`,
    [taskId]
  );
  await db.query(`DELETE FROM task_labels WHERE task_id = $1 AND NOT (label_id = ANY($2::uuid[]))`, [taskId, ids]);
  await db.query(`INSERT INTO task_labels (task_id, label_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, [taskId, ids]);
  const had = new Set(before.map((r) => r.id as string));
  const added = ids.length
    ? (await db.query(`SELECT name FROM space_labels WHERE id = ANY($1::uuid[]) ORDER BY position, lower(name)`, [ids.filter((id) => !had.has(id))])).rows
    : [];
  return { added: added.map((r) => r.name as string), removed: before.filter((r) => !ids.includes(r.id)).map((r) => r.name as string) };
}

/** A task moved to another space keeps only that space's labels; returns the names it lost. */
export async function keepSpaceLabels(db: Queryable, taskId: string, spaceId: string): Promise<string[]> {
  const { rows } = await db.query(
    `DELETE FROM task_labels tl USING space_labels l
     WHERE tl.task_id = $1 AND l.id = tl.label_id AND l.space_id <> $2 RETURNING l.name`,
    [taskId, spaceId]
  );
  return rows.map((r) => r.name as string);
}

function cleanName(v: unknown): string {
  const name = typeof v === "string" ? v.trim() : "";
  if (!name) throw bad("{label} is required", { label: "Name" });
  if (name.length > 40) throw bad("{label} is too long", { label: "Name" });
  return name;
}
function cleanColor(v: unknown): string {
  if (typeof v !== "string" || !COLOR.test(v)) throw bad("Invalid color");
  return v.toLowerCase();
}

type Req = FastifyRequest<{ Params: Record<string, string>; Body: Record<string, unknown> }>;

/** A label someone may manage: 404 if they cannot see its space, 403 if they are not one of its members. */
async function manageable(req: Req) {
  const id = req.params.id;
  if (!UUID.test(id)) throw notFound("Label not found");
  const l = await one(`SELECT * FROM space_labels WHERE id = $1`, [id]);
  if (!l || !(await spaceVisible(l.space_id, req.user!.id))) throw notFound("Label not found");
  if (!(await memberRole(l.space_id, req.user!.id))) throw forbidden();
  return l;
}

const duplicate = (err: unknown) => {
  if ((err as { code?: string }).code === "23505") throw bad("A label with this name already exists");
  throw err;
};

export async function labelRoutes(app: FastifyInstance) {
  // The labels of a space, for whoever can see it.
  app.get("/spaces/:id/labels", async (req: Req) => {
    const id = req.params.id;
    if (!UUID.test(id) || !(await spaceVisible(id, req.user!.id))) throw notFound("Space not found");
    const { rows } = await query(`SELECT * FROM space_labels WHERE space_id = $1 ORDER BY position, lower(name)`, [id]);
    return rows.map(presentLabel);
  });

  // Labels of the spaces one is a member of, by name (filters of "My tasks" and of the search).
  app.get("/me/labels", async (req) => {
    const { rows } = await query(
      `SELECT DISTINCT ON (lower(l.name)) l.name, l.color FROM space_labels l
       JOIN space_members m ON m.space_id = l.space_id AND m.user_id = $1 ORDER BY lower(l.name), l.created_at`,
      [req.user!.id]
    );
    return rows.map((r) => ({ name: r.name, color: r.color }));
  });

  app.post("/spaces/:id/labels", async (req: Req) => {
    const id = req.params.id;
    if (!UUID.test(id) || !(await spaceVisible(id, req.user!.id))) throw notFound("Space not found");
    if (!(await memberRole(id, req.user!.id))) throw forbidden();
    const b = req.body ?? {};
    const name = cleanName(b.name);
    const color = cleanColor(b.color);
    const n = await one(`SELECT count(*)::int AS n, COALESCE(max(position), 0) + 1 AS next FROM space_labels WHERE space_id = $1`, [id]);
    if (n!.n >= MAX_LABELS) throw bad("A space has {n} labels at most", { n: MAX_LABELS });
    const l = await one(
      `INSERT INTO space_labels (space_id, name, color, position, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, name, color, n!.next, req.user!.id]
    ).catch(duplicate);
    return presentLabel(l!);
  });

  app.patch("/labels/:id", async (req: Req) => {
    const l = await manageable(req);
    const b = req.body ?? {};
    const name = "name" in b ? cleanName(b.name) : l.name;
    const color = "color" in b ? cleanColor(b.color) : l.color;
    const position = typeof b.position === "number" && Number.isFinite(b.position) ? b.position : l.position;
    const row = await one(`UPDATE space_labels SET name = $2, color = $3, position = $4 WHERE id = $1 RETURNING *`, [l.id, name, color, position])
      .catch(duplicate);
    return presentLabel(row!);
  });

  // Deleting a label takes it off its tasks.
  app.delete("/labels/:id", async (req: Req) => {
    const l = await manageable(req);
    await query(`DELETE FROM space_labels WHERE id = $1`, [l.id]);
    return { ok: true };
  });
}
