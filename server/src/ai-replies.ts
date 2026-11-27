/**
 * The instance's AI answers for a person's AI agent ("<name> (MCP)"), when that person chose it (Settings › AI
 * agents): when a task is handed to the agent, or someone comments on one, the AI may write one comment — an answer,
 * or the questions needed to go on — and nothing else (it changes no task). The comment is recorded as the person's,
 * via their agent token (MCP tag), so it never triggers a reply itself and the Claude Code channel does not relay it.
 *
 * Every few seconds, one instance (an advisory lock) reads the history after the last entry looked at
 * (ai_reply_cursor), as the agent's event stream does (agent-events.ts). Confidential tasks never reach the AI.
 */
import { aiConfig, complete } from "./ai.js";
import { aiReplyEvents, type AgentEvent } from "./agent-events.js";
import { getTaskRow } from "./access.js";
import { parseAnswer, taskFacts } from "./assistant.js";
import { one, pool, type Row } from "./db.js";
import { taskTypeById } from "./pipeTypes.js";
import { runVia } from "./via.js";

/** Replies one person's agent may get from the AI in an hour (each one is a paid call). */
export const MAX_REPLIES_PER_HOUR = 30;

const RULES = (owner: string) => `You are the AI assistant acting for ${owner} in a task manager, shown to people as "${owner} (MCP)".
A task was just handed to you, or someone commented on a task handed to you. The task, its comments and the event are
given as JSON. You can do one thing only: write one comment on the task.
- When the event asks or says something you can answer from the task and its comments, answer it briefly.
- When something is missing or unclear to do the task, ask the questions needed (short, numbered, at most 5).
- You cannot change the task, its fields or its state: never claim you did.
- When no comment is useful (a thanks, nothing addressed to you, nothing missing), write none.
Write in the language of the comment, else of the task. Short Markdown.
Answer with one JSON object and nothing else: {"comment": string or null}`;

/** Whether this person's agent already had its share of replies this hour. */
async function overLimit(ownerId: string): Promise<boolean> {
  const r = await one(
    `SELECT count(*)::int AS n FROM task_events WHERE actor_id = $1 AND type = 'comment'
       AND details->>'aiReply' = 'true' AND created_at > now() - interval '1 hour'`,
    [ownerId]
  );
  return (r?.n ?? 0) >= MAX_REPLIES_PER_HOUR;
}

/** The comment the AI writes for one event, or null. */
async function replyTo(e: AgentEvent & { ownerId: string }, t: Row): Promise<string | null> {
  const cfg = aiConfig();
  if (!cfg?.model) return null;
  const owner = (await one(`SELECT name FROM users WHERE id = $1`, [e.ownerId]))?.name ?? "the person";
  const facts = await taskFacts(t, taskTypeById(t.task_type)?.fields ?? []);
  const event = e.type === "comment" ? { event: "comment", by: e.by, comment: e.comment } : { event: "handed to you", by: e.by };
  const text = await complete(cfg, RULES(owner), [{ role: "user", content: JSON.stringify({ task: facts, event }) }], { maxTokens: 2000 });
  const comment = parseAnswer(text).comment;
  return typeof comment === "string" && comment.trim() ? comment.trim().slice(0, 8000) : null;
}

type Commenter = (t: Row, actorId: string, body: string, details: object) => Promise<void>;

/** One pass: replies to what happened since the last pass. Returns the number of comments written. */
export async function runAiReplies(comment: Commenter, log: { warn: (o: object, m: string) => void } = console): Promise<number> {
  const client = await pool.connect();
  let written = 0;
  try {
    // One instance at a time; the others skip this pass.
    if (!(await client.query(`SELECT pg_try_advisory_lock(hashtext('ai_replies')) AS ok`)).rows[0].ok) return 0;
    try {
      // First pass: only what happens from now on.
      await client.query(
        `INSERT INTO ai_reply_cursor (id, event_id) SELECT 1, COALESCE(max(id), 0) FROM task_events ON CONFLICT (id) DO NOTHING`
      );
      const start = String((await client.query(`SELECT event_id FROM ai_reply_cursor WHERE id = 1`)).rows[0].event_id);
      const { events, cursor } = await aiReplyEvents(start);
      for (const e of events) {
        try {
          if (!aiConfig()?.model || (await overLimit(e.ownerId))) continue;
          // The agent's token, so that the comment shows as done via it.
          const token = await one(
            `SELECT id FROM api_tokens WHERE user_id = $1 AND kind = 'agent' AND revoked_at IS NULL
               AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1`,
            [e.ownerId]
          );
          const t = await getTaskRow(e.task.id);
          if (!token || !t?.assignee_agent) continue;
          const body = await replyTo(e, t);
          if (body) {
            await runVia({ id: token.id, kind: "agent" }, () => comment(t, e.ownerId, body, { aiReply: true }));
            written++;
          }
        } catch (err) {
          log.warn({ err, taskId: e.task.id }, "AI reply failed");
        } finally {
          // Each event is answered once, even when the AI failed.
          await client.query(`UPDATE ai_reply_cursor SET event_id = $1 WHERE id = 1`, [e.id]);
        }
      }
      await client.query(`UPDATE ai_reply_cursor SET event_id = GREATEST(event_id, $1::bigint) WHERE id = 1`, [cursor]);
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext('ai_replies'))`);
    }
  } finally {
    client.release();
  }
  return written;
}
