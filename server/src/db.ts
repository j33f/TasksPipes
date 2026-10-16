import pg from "pg";
import type { FastifyBaseLogger } from "fastify";
import { config } from "./config.js";
import { STATUSES, allPipeTypes, resolveStage, setCustomTypes, type PipeType, type TaskType } from "./pipeTypes.js";

// Return DATE columns as plain "YYYY-MM-DD" strings and bigint counts as numbers.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(20, (v: string) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

/** Anything that can run a query: the pool or a transaction client. */
export type Queryable = Pick<pg.PoolClient, "query">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export async function query<T extends Row = Row>(text: string, params: unknown[] = [], db: Queryable = pool) {
  return db.query<T>(text, params);
}

export async function one<T extends Row = Row>(text: string, params: unknown[] = [], db: Queryable = pool) {
  const { rows } = await db.query<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- UUIDv7 (RFC 9562): 48-bit Unix time in milliseconds, then random bits; ids sort by creation time.
-- PostgreSQL 17 has no built-in generator (uuidv7() comes with PostgreSQL 18).
CREATE OR REPLACE FUNCTION gen_uuidv7() RETURNS uuid AS $$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
        PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
        FROM 1 FOR 6),
      52, 1), 53, 1),
    'hex')::uuid
$$ LANGUAGE sql VOLATILE;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text,
  avatar_url text,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spaces (
  id uuid PRIMARY KEY DEFAULT gen_uuidv7(),
  kind text NOT NULL CHECK (kind IN ('user', 'team')),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name text,
  description text NOT NULL DEFAULT '',
  color text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'user' AND user_id IS NOT NULL) OR (kind = 'team' AND name IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS space_members (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  added_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX IF NOT EXISTS space_members_user_idx ON space_members(user_id);

CREATE TABLE IF NOT EXISTS pipes (
  id uuid PRIMARY KEY DEFAULT gen_uuidv7(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'open')),
  color text,
  position double precision NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipes_space_idx ON pipes(space_id);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_uuidv7(),
  number serial,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  space_id uuid NOT NULL REFERENCES spaces(id),
  pipe_id uuid REFERENCES pipes(id),
  status text NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog','ready','started','ongoing','blocked','abandoned','done')),
  position double precision NOT NULL DEFAULT 0,
  assignee_id uuid REFERENCES users(id),
  due_date date,
  outline_doc_id text,
  outline_doc_title text,
  outline_doc_url text,
  author_id uuid NOT NULL REFERENCES users(id),
  sender_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_space_idx ON tasks(space_id);
CREATE INDEX IF NOT EXISTS tasks_pipe_idx ON tasks(pipe_id);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id);

CREATE TABLE IF NOT EXISTS task_events (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL,
  comment text,
  from_space_id uuid, to_space_id uuid,
  from_pipe_id uuid, to_pipe_id uuid,
  from_status text, to_status text,
  from_assignee_id uuid, to_assignee_id uuid,
  from_due_date date, to_due_date date,
  from_doc jsonb, to_doc jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_events_task_idx ON task_events(task_id, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Pipe type (see pipeTypes.ts).
ALTER TABLE pipes ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'general';
ALTER TABLE pipes ADD COLUMN IF NOT EXISTS archived_at timestamptz;
-- Icon name or emoji; NULL means the default icon of the pipe type.
ALTER TABLE pipes ADD COLUMN IF NOT EXISTS icon text;
-- Every personal space has one default pipe, which cannot be archived or deleted.
ALTER TABLE pipes ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS pipes_default_idx ON pipes(space_id) WHERE is_default;

-- Pipes each person pinned in their sidebar.
CREATE TABLE IF NOT EXISTS pipe_pins (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pipe_id uuid NOT NULL REFERENCES pipes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pipe_id)
);

-- Board column of a task, specific to the type of its pipe (NULL in an incoming bucket);
-- its generic status stays in tasks.status. Task type and its field values.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'task';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS tasks_pipe_stage_idx ON tasks(pipe_id, stage);

-- History: column labels at the time of the event, and details (fields, files…).
ALTER TABLE task_events ADD COLUMN IF NOT EXISTS from_stage text;
ALTER TABLE task_events ADD COLUMN IF NOT EXISTS to_stage text;
ALTER TABLE task_events ADD COLUMN IF NOT EXISTS details jsonb;

-- Files attached to the "files" fields of a task, stored in the database.
CREATE TABLE IF NOT EXISTS task_files (
  id uuid PRIMARY KEY DEFAULT gen_uuidv7(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  field text NOT NULL,
  name text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL,
  content bytea NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_files_task_idx ON task_files(task_id);

-- Sub-tasks: a checklist inside a task.
CREATE TABLE IF NOT EXISTS task_items (
  id uuid PRIMARY KEY DEFAULT gen_uuidv7(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  position double precision NOT NULL DEFAULT 0,
  done_by uuid REFERENCES users(id),
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_items_task_idx ON task_items(task_id, position);

-- Pipe and task types made with the designer; their definition follows PipeType / TaskType.
CREATE TABLE IF NOT EXISTS custom_types (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('pipe', 'task')),
  definition jsonb NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The default personal pipe used to be called "Mes tâches".
UPDATE pipes SET name = 'Perso' WHERE is_default AND name = 'Mes tâches';

-- Databases created before UUIDv7: new rows get v7 ids too.
ALTER TABLE spaces ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE pipes ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE tasks ALTER COLUMN id SET DEFAULT gen_uuidv7();

-- Tasks in a personal space belong to that person: no explicit assignee there.
UPDATE tasks t SET assignee_id = NULL FROM spaces s
WHERE s.id = t.space_id AND s.kind = 'user' AND t.assignee_id IS NOT NULL;
`;

/** Creates the default "classic" pipe of personal spaces that lack one (all of them, or only `spaceId`). */
export async function ensureDefaultPipes(db: Queryable = pool, spaceId: string | null = null) {
  await db.query(
    `INSERT INTO pipes (space_id, name, kind, is_default, created_by, position)
     SELECT s.id, 'Perso', 'general', true, s.user_id, 0 FROM spaces s
     WHERE s.kind = 'user' AND ($1::uuid IS NULL OR s.id = $1)
       AND NOT EXISTS (SELECT 1 FROM pipes p WHERE p.space_id = s.id AND p.is_default)`,
    [spaceId]
  );
}

/** Loads the types made with the designer into the catalog. */
export async function loadCustomTypes() {
  const { rows } = await pool.query(
    `SELECT c.*, u.name AS created_by_name FROM custom_types c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.created_at`
  );
  const meta = (r: Row) => ({
    custom: true as const,
    // Types made before visibility existed stay public.
    visibility: r.definition.visibility === "private" ? ("private" as const) : ("public" as const),
    createdBy: r.created_by ? { id: r.created_by, name: r.created_by_name } : null,
    updatedAt: r.updated_at,
  });
  setCustomTypes(
    rows.filter((r) => r.kind === "pipe").map((r) => ({ ...r.definition, id: r.id, ...meta(r) }) as PipeType),
    rows.filter((r) => r.kind === "task").map((r) => ({ ...r.definition, id: r.id, ...meta(r) }) as TaskType)
  );
}

/**
 * Keeps tasks consistent with the columns of their pipe type (all types, or only `kind`):
 * a task in an existing column takes its status; a task without a column, or in a column that
 * no longer exists, goes to the column matching its status (or the nearest one).
 */
export async function syncStages(kind?: string) {
  for (const type of allPipeTypes().filter((t) => !kind || t.id === kind)) {
    for (const c of type.columns) {
      await pool.query(
        `UPDATE tasks t SET status = $3 FROM pipes p
         WHERE p.id = t.pipe_id AND p.kind = $1 AND t.stage = $2 AND t.status <> $3`,
        [type.id, c.id, c.status]
      );
    }
    const ids = type.columns.map((c) => c.id);
    for (const status of STATUSES) {
      const c = resolveStage(type.id, null, status);
      await pool.query(
        `UPDATE tasks t SET stage = $3, status = $4 FROM pipes p
         WHERE p.id = t.pipe_id AND p.kind = $1 AND t.status = $2 AND (t.stage IS NULL OR NOT (t.stage = ANY($5)))`,
        [type.id, status, c.id, c.status, ids]
      );
    }
  }
}

export async function migrate(log: FastifyBaseLogger) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(SCHEMA);
      await loadCustomTypes();
      await ensureDefaultPipes();
      await syncStages();
      log.info("Database schema up to date");
      return;
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (attempt >= 30 || !["ECONNREFUSED", "57P03", "ENOTFOUND", "EAI_AGAIN"].includes(code)) throw err;
      log.warn({ code, attempt }, "Database not ready, retrying");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
