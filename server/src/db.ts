import pg from "pg";
import type { FastifyBaseLogger } from "fastify";
import { config } from "./config.js";
import { tr, type Locale } from "./i18n.js";
import { STATUSES, allPipeTypes, resolveStage, setCustomTypes, type PipeType, type TaskType } from "./pipeTypes.js";
import { decrypt } from "./crypto-box.js";
import { setStoredSettings, settingDef } from "./settings-store.js";

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

-- Accounts: from Outline, or invited by e-mail (signing in with an e-mailed link, optionally with TOTP).
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_kind text NOT NULL DEFAULT 'outline';
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step bigint;
CREATE UNIQUE INDEX IF NOT EXISTS users_guest_email_idx ON users(lower(email)) WHERE auth_kind = 'email';
ALTER TABLE sessions ALTER COLUMN access_token DROP NOT NULL;

-- Outline accounts come from a server (the configured one, or another given on the login page):
-- the same Outline id on two servers makes two accounts. The internal id of an account from the
-- configured server is its Outline id; accounts from other servers get their own id.
ALTER TABLE users ADD COLUMN IF NOT EXISTS outline_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS outline_id text;
CREATE UNIQUE INDEX IF NOT EXISTS users_outline_idx ON users(outline_url, outline_id) WHERE outline_id IS NOT NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS outline_url text;

-- Display preferences of the account (NULL: follow the browser / the system).
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale text;
-- Languages are the files of locales/ (i18n.ts): checked by the app, no longer by a fixed list here.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_locale_check;
-- Pipe types someone turned off (no longer offered to them; their task types follow when no other type offers them).
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_pipe_types text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme text CHECK (theme IN ('light', 'dark'));

-- Calendar subscription link: hash of the token (lookup) and the token encrypted (shown again to its owner).
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS users_calendar_idx ON users(calendar_token_hash) WHERE calendar_token_hash IS NOT NULL;

-- Repositories connected to a pipe (GitHub / GitLab webhooks): the token routes the webhook, the secret
-- (encrypted) checks it.
CREATE TABLE IF NOT EXISTS pipe_integrations (
  id uuid PRIMARY KEY DEFAULT gen_uuidv7(),
  pipe_id uuid NOT NULL REFERENCES pipes(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('github', 'gitlab')),
  token text NOT NULL UNIQUE,
  secret text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_event_at timestamptz,
  UNIQUE (pipe_id, provider)
);

-- Pull/merge requests and commits that name a task (TP-123).
CREATE TABLE IF NOT EXISTS task_links (
  id uuid PRIMARY KEY DEFAULT gen_uuidv7(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pull_request', 'merge_request', 'commit')),
  url text NOT NULL,
  number integer,
  title text NOT NULL DEFAULT '',
  state text NOT NULL,
  repo text NOT NULL DEFAULT '',
  author text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, url)
);
CREATE INDEX IF NOT EXISTS tasks_number_idx ON tasks(number);

-- System accounts that author the moves made by GitHub and GitLab (they never sign in nor appear in lists).
INSERT INTO users (id, name, auth_kind) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'GitHub', 'system'),
  ('00000000-0000-4000-8000-0000000000a2', 'GitLab', 'system')
ON CONFLICT (id) DO NOTHING;

-- Reports: a pipe can send its daily activity report and, for development pipes, its weekly time report.
ALTER TABLE pipes ADD COLUMN IF NOT EXISTS daily_report boolean NOT NULL DEFAULT false;
ALTER TABLE pipes ADD COLUMN IF NOT EXISTS weekly_report boolean NOT NULL DEFAULT false;
-- Each scheduled sending, so that it happens once.
CREATE TABLE IF NOT EXISTS report_runs (
  kind text NOT NULL,
  period_end timestamptz NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, period_end)
);
CREATE INDEX IF NOT EXISTS task_events_pipe_idx ON task_events(to_pipe_id, created_at);

-- Who invited whom: the two accounts see each other.
CREATE TABLE IF NOT EXISTS invitations (
  inviter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (inviter_id, invitee_id)
);
CREATE INDEX IF NOT EXISTS invitations_invitee_idx ON invitations(invitee_id);
-- Inviting someone already on the platform is a request they accept or refuse (with the team to join, if any);
-- inviting a new address creates the account and the link at once.
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'accepted'
  CHECK (status IN ('pending', 'accepted', 'refused'));
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES spaces(id) ON DELETE SET NULL;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS responded_at timestamptz;

-- Pictures uploaded by e-mail accounts (Outline accounts use their Outline avatar).
CREATE TABLE IF NOT EXISTS user_avatars (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime text NOT NULL,
  content bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One-time sign-in links ('magic') and pending second factor steps ('totp'); ids are hashes.
CREATE TABLE IF NOT EXISTS login_tokens (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('magic', 'totp')),
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_tokens_user_idx ON login_tokens(user_id, created_at);

-- Disabled accounts cannot sign in, get no e-mail and are seen by nobody but themselves. 'unused_invitation': an
-- account created by an invitation and never signed in, once its link expired (48 hours); inviting it again
-- turns it back on.
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_reason text CHECK (disabled_reason IN ('unused_invitation'));
-- Disabled by an administrator of the instance (admin.ts), and by whom.
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_by uuid REFERENCES users(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_disabled_reason_check'
                 AND pg_get_constraintdef(oid) LIKE '%admin%') THEN
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_disabled_reason_check;
    ALTER TABLE users ADD CONSTRAINT users_disabled_reason_check CHECK (disabled_reason IN ('unused_invitation', 'admin'));
  END IF;
END $$;
-- A sign-in link sent by signing up again: using it turns an account disabled for an unused invitation back on.
ALTER TABLE login_tokens ADD COLUMN IF NOT EXISTS reactivates boolean NOT NULL DEFAULT false;

-- Who sees whom: oneself; Outline accounts of the same server see each other; otherwise, two accounts
-- see each other once one invited the other and the invitation is accepted. Disabled accounts are seen by no one.
CREATE OR REPLACE FUNCTION user_visible(viewer uuid, target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT viewer = target
    OR (EXISTS (SELECT 1 FROM users t WHERE t.id = target AND t.disabled_at IS NULL) AND (
      EXISTS (SELECT 1 FROM users v JOIN users t ON t.id = target
              WHERE v.id = viewer AND v.auth_kind = 'outline' AND t.auth_kind = 'outline' AND t.outline_url = v.outline_url)
      OR EXISTS (SELECT 1 FROM invitations i WHERE i.status = 'accepted'
                 AND ((i.inviter_id = viewer AND i.invitee_id = target) OR (i.inviter_id = target AND i.invitee_id = viewer)))))
$$;

-- Spaces one may reach: visible people's personal spaces; teams one belongs to, or, for an Outline account,
-- the teams created by an account of the same Outline server.
CREATE OR REPLACE FUNCTION space_visible(viewer uuid, sid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM spaces s WHERE s.id = sid AND (
      (s.kind = 'user' AND user_visible(viewer, s.user_id))
      OR (s.kind = 'team' AND (
        EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = s.id AND m.user_id = viewer)
        OR EXISTS (SELECT 1 FROM users v JOIN users c ON c.id = s.created_by
                   WHERE v.id = viewer AND v.auth_kind = 'outline' AND c.auth_kind = 'outline' AND c.outline_url = v.outline_url)))))
$$;

-- The default personal pipe used to be called "Mes tâches".
UPDATE pipes SET name = 'Perso' WHERE is_default AND name = 'Mes tâches';

-- Databases created before UUIDv7: new rows get v7 ids too.
ALTER TABLE spaces ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE pipes ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE tasks ALTER COLUMN id SET DEFAULT gen_uuidv7();

-- Tasks in a personal space belong to that person: no explicit assignee there.
UPDATE tasks t SET assignee_id = NULL FROM spaces s
WHERE s.id = t.space_id AND s.kind = 'user' AND t.assignee_id IS NOT NULL;

-- E-mail notifications (notifications.ts): each person's choices per kind ({"comment": "off", "dueHour": 7}…;
-- missing keys take the defaults), and the local day of their last due-date reminder (sent once a day).
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS due_reminded_on date;
-- Notifications waiting to be e-mailed (written with the history entry that causes them), then sent or dropped.
CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('received', 'assigned', 'refused', 'comment', 'overdue')),
  event_id bigint REFERENCES task_events(id) ON DELETE CASCADE,
  -- Overdue tasks: the due date they were reminded of, once.
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- How it went out ('immediate', 'digest', 'due'), or why not (dropped: turned off, access lost…).
  channel text,
  sent_at timestamptz,
  dropped_at timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_pending_idx ON notifications(user_id, task_id) WHERE sent_at IS NULL AND dropped_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_sent_idx ON notifications(user_id, task_id, sent_at) WHERE channel = 'immediate';
CREATE UNIQUE INDEX IF NOT EXISTS notifications_overdue_idx ON notifications(user_id, task_id, due_date) WHERE kind = 'overdue';

-- Global search (search.ts). Text is indexed in French and in English, accents ignored; a search uses the
-- language of the person searching. Each task has one row, kept up to date by triggers.
CREATE EXTENSION IF NOT EXISTS unaccent;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'tp_fr') THEN
    CREATE TEXT SEARCH CONFIGURATION tp_fr (COPY = french);
    ALTER TEXT SEARCH CONFIGURATION tp_fr ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'tp_en') THEN
    CREATE TEXT SEARCH CONFIGURATION tp_en (COPY = english);
    ALTER TEXT SEARCH CONFIGURATION tp_en ALTER MAPPING FOR hword, hword_part, word WITH unaccent, english_stem;
  END IF;
END $$;

-- The searchable text of a task, by weight: title; field values (people's ids left out) and linked document;
-- description and sub-tasks; comments (history entries with a comment, refusal reasons included).
CREATE OR REPLACE FUNCTION task_search_parts(tid uuid, OUT a text, OUT b text, OUT c text, OUT d text)
LANGUAGE sql STABLE AS $$
  SELECT t.title,
    left(concat_ws(' ',
      (SELECT string_agg(v #>> '{}', ' ') FROM jsonb_path_query(t.fields, 'strict $.**') v
       WHERE jsonb_typeof(v) = 'string' AND (v #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
      t.outline_doc_title), 100000),
    left(concat_ws(' ', t.description,
      (SELECT string_agg(i.text, ' ' ORDER BY i.position) FROM task_items i WHERE i.task_id = t.id)), 100000),
    left((SELECT string_agg(e.comment, ' ' ORDER BY e.id) FROM task_events e WHERE e.task_id = t.id AND e.comment IS NOT NULL), 100000)
  FROM tasks t WHERE t.id = tid
$$;

CREATE TABLE IF NOT EXISTS task_search (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  doc tsvector NOT NULL,
  -- Version of the indexed text (task_search_refresh): rows of an older one are rebuilt at start.
  version smallint NOT NULL
);
CREATE INDEX IF NOT EXISTS task_search_doc_idx ON task_search USING gin(doc);

CREATE OR REPLACE FUNCTION task_search_refresh(tid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO task_search (task_id, doc, version)
  SELECT tid,
    setweight(to_tsvector('tp_fr', coalesce(p.a, '')), 'A') || setweight(to_tsvector('tp_en', coalesce(p.a, '')), 'A') ||
    setweight(to_tsvector('tp_fr', coalesce(p.b, '')), 'B') || setweight(to_tsvector('tp_en', coalesce(p.b, '')), 'B') ||
    setweight(to_tsvector('tp_fr', coalesce(p.c, '')), 'C') || setweight(to_tsvector('tp_en', coalesce(p.c, '')), 'C') ||
    setweight(to_tsvector('tp_fr', coalesce(p.d, '')), 'D') || setweight(to_tsvector('tp_en', coalesce(p.d, '')), 'D'),
    1
  FROM task_search_parts(tid) p WHERE p.a IS NOT NULL
  ON CONFLICT (task_id) DO UPDATE SET doc = EXCLUDED.doc, version = EXCLUDED.version
$$;

CREATE OR REPLACE FUNCTION task_search_on_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM task_search_refresh(NEW.id);
  RETURN NULL;
END $$;
-- Sub-tasks and history entries. A task being deleted is no longer found, so nothing is written for it.
CREATE OR REPLACE FUNCTION task_search_on_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM task_search_refresh(CASE WHEN TG_OP = 'DELETE' THEN OLD.task_id ELSE NEW.task_id END);
  RETURN NULL;
END $$;
-- History entries only matter when they hold a comment.
CREATE OR REPLACE FUNCTION task_search_on_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.comment IS NOT NULL THEN PERFORM task_search_refresh(OLD.task_id); END IF;
  ELSIF NEW.comment IS NOT NULL OR (TG_OP = 'UPDATE' AND OLD.comment IS NOT NULL) THEN
    PERFORM task_search_refresh(NEW.task_id);
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER task_search_tasks AFTER INSERT OR UPDATE OF title, description, fields, outline_doc_title ON tasks
  FOR EACH ROW EXECUTE FUNCTION task_search_on_task();
CREATE OR REPLACE TRIGGER task_search_items AFTER INSERT OR UPDATE OF text OR DELETE ON task_items
  FOR EACH ROW EXECUTE FUNCTION task_search_on_item();
CREATE OR REPLACE TRIGGER task_search_events AFTER INSERT OR UPDATE OF comment OR DELETE ON task_events
  FOR EACH ROW EXECUTE FUNCTION task_search_on_event();
-- Tasks made before the search, or indexed by an older version.
SELECT task_search_refresh(t.id) FROM tasks t LEFT JOIN task_search s ON s.task_id = t.id WHERE s.version IS DISTINCT FROM 1;

-- Deleting one's account (account.ts): a link confirms it (purpose 'delete'). What the account did stays in the
-- history under a placeholder account of its own ("Deleted account", auth_kind 'deleted'), never signed in.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'login_tokens_purpose_check'
                 AND pg_get_constraintdef(oid) LIKE '%delete%') THEN
    ALTER TABLE login_tokens DROP CONSTRAINT IF EXISTS login_tokens_purpose_check;
    ALTER TABLE login_tokens ADD CONSTRAINT login_tokens_purpose_check CHECK (purpose IN ('magic', 'totp', 'delete'));
  END IF;
END $$;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Personal access tokens of the public API (api.ts): only a hash is kept; the token is shown once, at creation.
CREATE TABLE IF NOT EXISTS api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  -- The first characters of the token, to tell tokens apart in the list.
  prefix text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('read', 'write')),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens(user_id);

-- Outgoing webhooks of a pipe (webhooks.ts): the secret signing the deliveries is encrypted with APP_SECRET.
CREATE TABLE IF NOT EXISTS pipe_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_uuidv7(),
  pipe_id uuid NOT NULL REFERENCES pipes(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipe_webhooks_pipe_idx ON pipe_webhooks(pipe_id);
-- Posting to a chat channel (chat.ts): how deliveries are written, and in which language.
ALTER TABLE pipe_webhooks ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'json' CHECK (format IN ('json', 'slack', 'mattermost', 'teams'));
ALTER TABLE pipe_webhooks ADD COLUMN IF NOT EXISTS locale text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipe_webhooks_format_check'
                 AND pg_get_constraintdef(oid) LIKE '%discord%') THEN
    ALTER TABLE pipe_webhooks DROP CONSTRAINT IF EXISTS pipe_webhooks_format_check;
    ALTER TABLE pipe_webhooks ADD CONSTRAINT pipe_webhooks_format_check CHECK (format IN ('json', 'slack', 'mattermost', 'teams', 'discord'));
  END IF;
END $$;
-- Deliveries, written with the history entry that causes them, then sent and retried with growing delays.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id bigserial PRIMARY KEY,
  webhook_id uuid NOT NULL REFERENCES pipe_webhooks(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  failed_at timestamptz,
  last_status integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx ON webhook_deliveries(next_attempt_at) WHERE delivered_at IS NULL AND failed_at IS NULL;
CREATE INDEX IF NOT EXISTS webhook_deliveries_hook_idx ON webhook_deliveries(webhook_id, id DESC);

-- Recurring tasks (recurrence.ts): a series makes a task on each date of its rule; each task knows its series and
-- date, and a series has one task per date at most.
CREATE TABLE IF NOT EXISTS task_recurrences (
  id uuid PRIMARY KEY DEFAULT gen_uuidv7(),
  -- {"freq": "monthly", "interval": 1, "monthly": {"kind": "weekday", "nth": 1, "weekday": 1}}…
  rule jsonb NOT NULL,
  -- At fixed dates (made lead_days ahead), or once the previous task is done.
  mode text NOT NULL CHECK (mode IN ('schedule', 'after_done')),
  lead_days integer NOT NULL DEFAULT 0 CHECK (lead_days BETWEEN 0 AND 90),
  starts_on date NOT NULL,
  ends_on date,
  -- The next date to make a task for (none once ended).
  next_on date,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_recurrences_due_idx ON task_recurrences(next_on) WHERE active;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_id uuid REFERENCES task_recurrences(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS occurrence_on date;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_occurrence_idx ON tasks(recurrence_id, occurrence_on) WHERE recurrence_id IS NOT NULL;

-- @mentions (mentions.ts) are notified too.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_kind_check'
                 AND pg_get_constraintdef(oid) LIKE '%mention%') THEN
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN ('received', 'assigned', 'refused', 'comment', 'mention', 'overdue'));
  END IF;
END $$;

-- Dependencies between tasks (dependencies.ts): task_id waits for blocker_id to be done or abandoned.
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocker_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, blocker_id),
  CHECK (task_id <> blocker_id)
);
CREATE INDEX IF NOT EXISTS task_dependencies_blocker_idx ON task_dependencies(blocker_id);

-- A task no longer blocked is notified too.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_kind_check'
                 AND pg_get_constraintdef(oid) LIKE '%unblocked%') THEN
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN ('received', 'assigned', 'refused', 'comment', 'mention', 'unblocked', 'overdue'));
  END IF;
END $$;

-- Labels of a space (labels.ts), put on its tasks.
CREATE TABLE IF NOT EXISTS space_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  position double precision NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS space_labels_name_idx ON space_labels(space_id, lower(name));
CREATE TABLE IF NOT EXISTS task_labels (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES space_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);
CREATE INDEX IF NOT EXISTS task_labels_label_idx ON task_labels(label_id);
-- Priority of any task: 1 urgent, 2 high, 3 medium, 4 low; none when null.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority smallint CHECK (priority BETWEEN 1 AND 4);

-- Estimates and time logged by hand (worklog.ts), beside the time computed from the history.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimate_minutes integer CHECK (estimate_minutes BETWEEN 1 AND 60000);
CREATE TABLE IF NOT EXISTS task_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  -- Kept when the account is deleted: moved to its placeholder, as comments are.
  user_id uuid NOT NULL REFERENCES users(id),
  spent_on date NOT NULL,
  minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_time_entries_task_idx ON task_time_entries(task_id, spent_on);
CREATE INDEX IF NOT EXISTS task_time_entries_user_idx ON task_time_entries(user_id, spent_on);

-- Web Push (push.ts): the devices people turned notifications on for. The endpoint and keys are kept encrypted with
-- APP_SECRET (they are read to send), the endpoint's hash finds a device again.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint_hash text NOT NULL UNIQUE,
  data text NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);
-- When a notification was pushed to devices, or found needing no push.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pushed_at timestamptz;

-- Accounts signing in with the company's OpenID Connect provider (oidc.ts): auth_kind 'oidc', or an e-mail account
-- linked to it. The provider and the person's id there name the account; whether it vouched for the address counts
-- for ADMIN_EMAILS.
ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_issuer text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_sub text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_email_verified boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS users_oidc_idx ON users(oidc_issuer, oidc_sub) WHERE oidc_sub IS NOT NULL;

-- Settings of the instance changed by its administrators (settings.ts): e-mail, Outline, sign-in. An environment
-- variable, when set, wins over them. Secrets are kept encrypted with APP_SECRET.
CREATE TABLE IF NOT EXISTS instance_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Who changed which setting, when; the values of secrets are never kept here.
CREATE TABLE IF NOT EXISTS instance_settings_history (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- Changes of data made once (their name is kept when done).
CREATE TABLE IF NOT EXISTS schema_steps (name text PRIMARY KEY, done_at timestamptz NOT NULL DEFAULT now());
-- The "Priorité" field of user stories became the priority of every task: its values are copied once (they stay
-- in the fields, no longer shown).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_steps WHERE name = 'user-story-priority') THEN
    UPDATE tasks SET priority = CASE fields->>'priorite' WHEN 'Critique' THEN 1 WHEN 'Haute' THEN 2 WHEN 'Moyenne' THEN 3 WHEN 'Basse' THEN 4 END
    WHERE task_type = 'user_story' AND priority IS NULL AND fields->>'priorite' IN ('Critique', 'Haute', 'Moyenne', 'Basse');
    INSERT INTO schema_steps (name) VALUES ('user-story-priority') ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Documents linked to a pipe: Outline documents, or pages elsewhere (office suites, design tools, code forges…).
CREATE TABLE IF NOT EXISTS pipe_links (
  id uuid PRIMARY KEY DEFAULT gen_uuidv7(),
  pipe_id uuid NOT NULL REFERENCES pipes(id) ON DELETE CASCADE,
  source text NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  outline_doc_id text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipe_links_pipe_idx ON pipe_links(pipe_id);
`;

/**
 * Creates the default "classic" pipe of personal spaces that lack one (all of them, or only `spaceId`),
 * named in the given language.
 */
export async function ensureDefaultPipes(db: Queryable = pool, spaceId: string | null = null, lang: Locale = config.defaultLocale) {
  await db.query(
    `INSERT INTO pipes (space_id, name, kind, is_default, created_by, position)
     SELECT s.id, $2, 'general', true, s.user_id, 0 FROM spaces s
     WHERE s.kind = 'user' AND ($1::uuid IS NULL OR s.id = $1)
       AND NOT EXISTS (SELECT 1 FROM pipes p WHERE p.space_id = s.id AND p.is_default)`,
    [spaceId, tr(lang, "Personal")]
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

/** Loads the settings changed in the administration (secrets decrypted) into settings-store.ts. */
export async function loadSettings(db: Queryable = pool) {
  const { rows } = await db.query(`SELECT key, value FROM instance_settings`);
  const values = new Map<string, unknown>();
  for (const r of rows) {
    const def = settingDef(r.key);
    if (!def) continue;
    try {
      values.set(r.key, def.kind === "secret" ? decrypt(r.value?.enc) ?? "" : r.value);
    } catch {
      // Encrypted with another APP_SECRET: set it again in the administration.
    }
  }
  setStoredSettings(values);
}

export async function migrate(log: FastifyBaseLogger) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(SCHEMA);
      await loadSettings();
      // Accounts made before several Outline servers were possible come from the configured one.
      if (config.outlineUrl) {
        await pool.query(
          `UPDATE users SET outline_url = $1, outline_id = id::text WHERE auth_kind = 'outline' AND outline_url IS NULL`,
          [config.outlineUrl]
        );
      }
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
