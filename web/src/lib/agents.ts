/** Tasks handed to a person's AI agent ("Toto (MCP)"): how an owner choice reads and is sent. */
import type { UserRef } from "./types";

/** The value of an owner choice: a person's id, or `agent:<id>` for their AI agent. */
export const ownerValue = (assignee: UserRef | null | undefined): string | null =>
  assignee ? (assignee.agent ? `agent:${assignee.id}` : assignee.id) : null;

/** What the API takes for an owner choice (see ownerValue). */
export function ownerBody(v: string | null): { assigneeId: string | null; assigneeAgent: boolean } {
  if (v?.startsWith("agent:")) return { assigneeId: v.slice(6), assigneeAgent: true };
  return { assigneeId: v, assigneeAgent: false };
}

/**
 * The agents an owner choice offers: one's own (only its person hands tasks to it), when one has one that works, and
 * the one a task is already handed to (shown, not offered: someone else's, or one's own without an agent any more).
 */
export function agentChoices(me: UserRef | null | undefined, hasAgent: boolean, current?: UserRef | null) {
  const out: { id: string; name: string; disabled?: boolean }[] = [];
  if (me && hasAgent) out.push({ id: me.id, name: me.name });
  if (current?.agent && !out.some((a) => a.id === current.id)) out.push({ id: current.id, name: current.name, disabled: true });
  return out;
}
