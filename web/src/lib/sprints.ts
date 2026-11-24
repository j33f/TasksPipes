/** Sprints of a pipe in sprints: their days, progress and points (the server plans them, sprints.ts there). */
import type { Sprint, SprintSettings, Task, Velocity } from "./types";
import { intlLocale } from "./i18n.svelte";

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number) => new Date(asDate(day).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/** ISO weekday: 1 Monday … 7 Sunday. */
export const isoWeekday = (day: string) => asDate(day).getUTCDay() || 7;

/** The days worked from `start` to `end`, both included. */
export function workingDays(start: string, end: string, workDays: number[]): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) if (workDays.includes(isoWeekday(d))) out.push(d);
  return out;
}

/** Where a sprint stands on `today`: its day of work (from 1; 0 before it starts) out of its days of work. */
export function sprintDay(sprint: Pick<Sprint, "startsOn" | "endsOn">, today: string, workDays: number[]) {
  const all = workingDays(sprint.startsOn, sprint.endsOn, workDays);
  return { day: all.filter((d) => d <= today).length, total: all.length };
}

/** Points and tasks of a sprint (dropped tasks are left out). */
export function sprintStats(tasks: Pick<Task, "sprintId" | "status" | "points">[], sprintId: string | null) {
  const mine = tasks.filter((t) => (t.sprintId ?? null) === sprintId && t.status !== "abandoned");
  const done = mine.filter((t) => t.status === "done");
  const pts = (list: typeof mine) => list.reduce((n, t) => n + (t.points ?? 0), 0);
  return { tasks: mine.length, doneTasks: done.length, points: pts(mine), donePoints: pts(done), unestimated: mine.filter((t) => t.points === null).length };
}

/** The sprints still to finish, the one under way first, then the planned ones in order. */
export const openSprints = (sprints: Sprint[]) =>
  sprints.filter((s) => s.status !== "closed").sort((a, b) => (a.status === "active" ? -1 : b.status === "active" ? 1 : a.number - b.number));

/** The sprint a board shows first: the one under way, if any. */
export const activeSprint = (sprints: Sprint[] | null | undefined) => sprints?.find((s) => s.status === "active") ?? null;

/** Points a sprint can take: the pipe's velocity (learned, or set in its settings). */
export const capacity = (pipe: { velocity?: Velocity | null; sprintSettings?: SprintSettings | null }) =>
  pipe.velocity ? pipe.velocity.value : (pipe.sprintSettings?.initialVelocity ?? null);

/** A figure in the reader's language, with one decimal at most (12,5 in French). */
export const num = (n: number) => n.toLocaleString(intlLocale(), { maximumFractionDigits: 1 });

/** ISO weekdays, Monday first, for the settings. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
