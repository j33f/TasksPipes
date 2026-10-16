import pg from "pg";
import type { FastifyBaseLogger } from "fastify";
import { config } from "./config.js";

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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
-- Every personal space has one default pipe, which cannot be archived or deleted.
ALTER TABLE pipes ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS pipes_default_idx ON pipes(space_id) WHERE is_default;

-- Tasks in a personal space belong to that person: no explicit assignee there.
UPDATE tasks t SET assignee_id = NULL FROM spaces s
WHERE s.id = t.space_id AND s.kind = 'user' AND t.assignee_id IS NOT NULL;
`;

/** Creates the default "classic" pipe of personal spaces that lack one (all of them, or only `spaceId`). */
export async function ensureDefaultPipes(db: Queryable = pool, spaceId: string | null = null) {
  await db.query(
    `INSERT INTO pipes (space_id, name, kind, is_default, created_by, position)
     SELECT s.id, 'Mes tâches', 'general', true, s.user_id, 0 FROM spaces s
     WHERE s.kind = 'user' AND ($1::uuid IS NULL OR s.id = $1)
       AND NOT EXISTS (SELECT 1 FROM pipes p WHERE p.space_id = s.id AND p.is_default)`,
    [spaceId]
  );
}

export async function migrate(log: FastifyBaseLogger) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(SCHEMA);
      await ensureDefaultPipes();
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
