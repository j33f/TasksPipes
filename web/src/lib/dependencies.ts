/** Dependencies between tasks: what a linked task shows, and moving a task on while it still waits. */
import type { Dependency, Status, Task } from "./types";
import { t, tn } from "./i18n.svelte";

/** Statuses of work under way or finished (the server notes reaching one while blocked). */
const FORWARD: Status[] = ["started", "ongoing", "done"];

/** Whether going to `to` moves a task on while it still waits for other tasks. */
export const movesWhileBlocked = (task: Pick<Task, "status" | "blockers">, to: Status | undefined) =>
  Boolean(to) && task.blockers > 0 && to !== task.status && FORWARD.includes(to!);

/** Asks before moving a blocked task on; true to go ahead. */
export function confirmWhileBlocked(task: Pick<Task, "status" | "blockers">, to: Status | undefined): boolean {
  if (!movesWhileBlocked(task, to)) return true;
  return confirm(tn(task.blockers, "This task still waits for a task to be finished. Move it anyway?",
    "This task still waits for {n} tasks to be finished. Move it anyway?"));
}

/** "#12 Title" for a task one can open, its title alone otherwise, nothing of a masked one. */
export function dependencyLabel(d: Dependency): string {
  if (d.masked) return t("Task not accessible");
  return d.visible ? `#${d.number} ${d.title}` : (d.title ?? "");
}
