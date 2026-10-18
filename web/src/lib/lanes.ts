/** Swimlanes of a board: one row of columns per owner or per task type. */
import { app } from "./app.svelte";
import { t } from "./i18n.svelte";
import type { Task } from "./types";

export interface Lane {
  id: string;
  /** Shown above the row; none for the single lane of a board without lanes. */
  label: string | null;
  has: (task: Task) => boolean;
  /** What a task dropped in this lane changes (PATCH /tasks/:id). */
  change: Record<string, unknown> | null;
}

/** The lanes of these tasks: by owner (named, then unassigned), by type (in catalog order), or a single one. */
export function boardLanes(tasks: Task[], by: "none" | "owner" | "type"): Lane[] {
  if (by === "owner") {
    const owners = [...new Map(tasks.filter((x) => x.assignee).map((x) => [x.assignee!.id, x.assignee!])).values()]
      .sort((a, b) => a.name.localeCompare(b.name));
    return [
      ...owners.map((u) => ({ id: `owner:${u.id}`, label: u.name, has: (x: Task) => x.assignee?.id === u.id, change: { assigneeId: u.id } })),
      { id: "owner:none", label: t("Unassigned"), has: (x: Task) => !x.assignee, change: { assigneeId: null } },
    ];
  }
  if (by === "type") {
    const ids = new Set(tasks.map((x) => x.taskType));
    return app.taskTypes.filter((tt) => ids.has(tt.id))
      .map((tt) => ({ id: `type:${tt.id}`, label: tt.label, has: (x: Task) => x.taskType === tt.id, change: { taskType: tt.id } }));
  }
  return [{ id: "all", label: null, has: () => true, change: null }];
}

/** "3 / 5" when a column has a limit, else the count. */
export const loadLabel = (count: number, limit?: number) => (limit ? `${count} / ${limit}` : String(count));
export const overLimit = (count: number, limit?: number) => Boolean(limit && count > limit);
