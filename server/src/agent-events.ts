/**
 * What happens to the tasks handed to a person's AI agent, pushed to the agent (GET /mcp/events, Server-Sent Events,
 * with its agent token): a task handed to it, a comment someone writes on one. The TasksPipes channel for Claude Code
 * (web/public/taskspipes-channel.mjs) relays them into the agent's session, so that it does not have to ask.
 *
 * Events are read from the history (task_events) after the last one sent, every few seconds: every instance of the
 * app sees them, and a stream reopened with Last-Event-ID misses nothing. The agent's limits apply as on /mcp: its
 * spaces only, never a confidential task, and never what the agent did itself.
 */
import { isConfidential } from "./access.js";
import { one, query } from "./db.js";

export interface AgentEvent {
  id: string;
  type: "assigned" | "comment";
  task: { id: string; number: number; title: string; space: string };
  by: string;
  at: string;
  comment?: string;
}

/** The last history entry: a new stream starts after it (only what happens from now on). */
export const lastEventId = async () => String((await one(`SELECT COALESCE(max(id), 0) AS id FROM task_events`))!.id);

/**
 * Events for the agent of `userId` after history entry `after`, oldest first, and the entry to read after next time
 * (past those left out, confidential or out of its spaces).
 */
export async function agentEvents(userId: string, spaceIds: Set<string> | null, after: string, limit = 50): Promise<{ events: AgentEvent[]; cursor: string }> {
  const { rows } = await query(
    `SELECT e.id, e.type, e.comment, e.created_at, u.name AS actor_name,
            t.id AS task_id, t.number, t.title, t.task_type, t.space_id, s.name AS space_name, p.kind AS pipe_kind
     FROM task_events e
     JOIN tasks t ON t.id = e.task_id
     JOIN spaces s ON s.id = t.space_id
     LEFT JOIN pipes p ON p.id = t.pipe_id
     JOIN users u ON u.id = e.actor_id
     LEFT JOIN api_tokens k ON k.id = e.via_token_id
     WHERE e.id > $2::bigint
       AND t.assignee_agent AND COALESCE(t.assignee_id, s.user_id) = $1
       AND p.archived_at IS NULL
       AND k.kind IS DISTINCT FROM 'agent'
       AND ((e.type = 'comment' AND e.comment IS NOT NULL)
            OR (e.to_assignee_agent IS TRUE AND e.from_assignee_agent IS NOT TRUE))
     ORDER BY e.id LIMIT $3`,
    [userId, after, limit]
  );
  const events = rows
    .filter((r) => (!spaceIds || spaceIds.has(r.space_id)) && !isConfidential(r))
    .map((r) => ({
      id: String(r.id),
      type: r.type === "comment" ? "comment" : "assigned",
      task: { id: r.task_id, number: r.number, title: r.title, space: r.space_name },
      by: r.actor_name,
      at: new Date(r.created_at).toISOString(),
      ...(r.type === "comment" ? { comment: String(r.comment).slice(0, 8000) } : {}),
    } as AgentEvent));
  return { events, cursor: rows.length ? String(rows.at(-1)!.id) : after };
}
