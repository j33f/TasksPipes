/**
 * Global search: tasks one can see, in every pipe and incoming bucket, by title, description, sub-tasks, field
 * values, linked document, comments or number (TP-123). Full text in PostgreSQL (task_search, see the schema);
 * access is checked in the query itself, with the rule of taskPermissions.
 */
import { query } from "./db.js";
import { SPACE_NAME, isConfidential, taskVisibleSql, teamOnlyKinds } from "./access.js";
import { TASK_KEY_PREFIX } from "./git.js";
import { localize, type Locale } from "./i18n.js";
import { resolveStage } from "./pipeTypes.js";

export const SEARCH_LIMIT = 50;
const CONFIG: Record<Locale, string> = { fr: "tp_fr", en: "tp_en" };
// Highlighted words come between these two characters (removed from the text beforehand), never as HTML.
export const MARK_START = "\u0002";
export const MARK_END = "\u0003";
const HEADLINE = `StartSel=${MARK_START}, StopSel=${MARK_END}, MaxWords=24, MinWords=8, MaxFragments=2, FragmentDelimiter=" … "`;

export interface SearchFilters {
  /** A status, or "open": neither done nor abandoned. */
  status?: string | null;
  /** Owner: the person of a personal space, or the assignee elsewhere. */
  owner?: string | null;
  type?: string | null;
}

/**
 * The words of a search as a prefix query (`'plan':* & 'stag':*`), or null. Only letters and digits are kept, so
 * the text given to to_tsquery cannot hold its operators; one-letter words must match whole.
 */
export function prefixQuery(q: string): string | null {
  const words = (q.normalize("NFC").match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((w) => w.slice(0, 50));
  return words.length ? words.map((w) => (w.length > 1 ? `'${w}':*` : `'${w}'`)).join(" & ") : null;
}

/** A task number in the search (`TP-123`, `tp123`, `123`), or null. */
export function taskNumber(q: string): number | null {
  const m = q.trim().match(new RegExp(`^(?:${TASK_KEY_PREFIX}\\s*-?\\s*)?(\\d{1,9})$`, "i"));
  return m ? Number(m[1]) : null;
}

export async function searchTasks(userId: string, lang: Locale, q: string, filters: SearchFilters = {}) {
  const tsq = prefixQuery(q);
  if (!tsq) return [];
  const cfg = CONFIG[lang];
  const { rows } = await query(
    `WITH hits AS (
       SELECT h.task_id, max(h.rank) AS rank FROM (
         SELECT ts.task_id, ts_rank(ts.doc, to_tsquery($2::regconfig, $3)) AS rank
         FROM task_search ts WHERE ts.doc @@ to_tsquery($2::regconfig, $3)
         UNION ALL
         SELECT id, 100 FROM tasks WHERE number = $4
       ) h GROUP BY h.task_id
     )
     SELECT t.id, t.number, t.title, t.status, t.stage, t.task_type, t.space_id, t.pipe_id,
            p.name AS pipe_name, p.kind AS pipe_kind, p.archived_at IS NOT NULL AS pipe_archived,
            ${SPACE_NAME} AS space_name, s.kind AS space_kind,
            ow.id AS owner_id, ow.name AS owner_name, ow.avatar_url AS owner_avatar
     FROM hits h
     JOIN tasks t ON t.id = h.task_id
     JOIN spaces s ON s.id = t.space_id
     LEFT JOIN users su ON su.id = s.user_id
     LEFT JOIN pipes p ON p.id = t.pipe_id
     LEFT JOIN users ow ON ow.id = COALESCE(s.user_id, t.assignee_id)
     WHERE ${taskVisibleSql("$1", "$5")}
       AND ($6::text IS NULL OR t.status = $6 OR ($6 = 'open' AND t.status NOT IN ('done', 'abandoned')))
       AND ($7::uuid IS NULL OR COALESCE(s.user_id, t.assignee_id) = $7)
       AND ($8::text IS NULL OR t.task_type = $8)
     ORDER BY h.rank DESC, t.updated_at DESC
     LIMIT ${SEARCH_LIMIT}`,
    [userId, cfg, tsq, taskNumber(q), teamOnlyKinds(), filters.status ?? null, filters.owner ?? null, filters.type ?? null]
  );

  // Excerpts of what matched besides the title; none for confidential tasks, whose content stays on their page.
  const open = rows.filter((t) => !isConfidential(t)).map((t) => t.id);
  const snippets = new Map<string, string>();
  if (open.length) {
    const res = await query(
      `SELECT x.id, ts_headline($1::regconfig, x.body, to_tsquery($1::regconfig, $2), $4) AS snippet
       FROM (SELECT id, translate(concat_ws(' … ', p.b, p.c, p.d), chr(2) || chr(3), '') AS body
             FROM unnest($3::uuid[]) id, task_search_parts(id) p) x
       WHERE to_tsvector($1::regconfig, x.body) @@ to_tsquery($1::regconfig, $2)`,
      [cfg, tsq, open, HEADLINE]
    );
    for (const r of res.rows) snippets.set(r.id, r.snippet);
  }

  return rows.map((t) => ({
    id: t.id,
    number: t.number,
    key: `${TASK_KEY_PREFIX}-${t.number}`,
    title: t.title,
    status: t.status,
    taskType: t.task_type,
    space: { id: t.space_id, name: t.space_name, kind: t.space_kind },
    pipe: t.pipe_id ? { id: t.pipe_id, name: t.pipe_name, archived: t.pipe_archived } : null,
    // Board column; none in an incoming bucket.
    column: t.pipe_id ? localize(lang, resolveStage(t.pipe_kind, t.stage, t.status).label) : null,
    owner: t.owner_id ? { id: t.owner_id, name: t.owner_name, avatarUrl: t.owner_avatar } : null,
    confidential: isConfidential(t),
    snippet: snippets.get(t.id) ?? null,
  }));
}
