/**
 * The timeline (Gantt) of a pipe in sprints: each task as a bar from its start to its due date. A task missing one of
 * them takes it from its sprint (shown as such); a task with no date and no sprint is not drawn. Its sprints are
 * bands, its releases milestones.
 */
import { addDays } from "./sprints";
import type { Sprint, Task } from "./types";

export interface Span {
  start: string;
  end: string;
  /** The start or the end comes from the sprint, not from the task. */
  inferred: boolean;
}

/** The days a task covers on the timeline, or null if it has neither dates nor a sprint. */
export function taskSpan(task: Pick<Task, "startDate" | "dueDate" | "sprintId">, sprint: Pick<Sprint, "startsOn" | "endsOn"> | null | undefined): Span | null {
  const s = task.startDate ?? null;
  const d = task.dueDate ?? null;
  if (s && d) return { start: s, end: d < s ? s : d, inferred: false };
  if (sprint) {
    const start = s ?? (d && d < sprint.startsOn ? d : sprint.startsOn);
    const end = d ?? (s && s > sprint.endsOn ? s : sprint.endsOn);
    return { start, end: end < start ? start : end, inferred: true };
  }
  // Only one date: a single day.
  if (s || d) return { start: (s ?? d)!, end: (s ?? d)!, inferred: false };
  return null;
}

/** Days between two days (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The days a timeline shows: a little before the first and after the last, today included. */
export function timelineRange(spans: { start: string; end: string }[], today: string, margin = 2) {
  if (!spans.length) return { start: addDays(today, -margin), end: addDays(today, 14) };
  const start = spans.reduce((m, s) => (s.start < m ? s.start : m), spans[0].start);
  const end = spans.reduce((m, s) => (s.end > m ? s.end : m), spans[0].end);
  return { start: addDays(start < today ? start : today, -margin), end: addDays(end > today ? end : today, margin) };
}

/** Every day from start to end, both included. */
export function dayList(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 2000; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The dates of a bar moved or stretched by `days`: whole bar, its start, or its end (never past each other). */
export function shiftSpan(span: { start: string; end: string }, edge: "move" | "start" | "end", days: number) {
  if (edge === "move") return { start: addDays(span.start, days), end: addDays(span.end, days) };
  if (edge === "start") {
    const start = addDays(span.start, days);
    return { start: start > span.end ? span.end : start, end: span.end };
  }
  const end = addDays(span.end, days);
  return { start: span.start, end: end < span.start ? span.start : end };
}
