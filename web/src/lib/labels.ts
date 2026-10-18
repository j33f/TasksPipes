/** Labels and priority of tasks: names, colors, and the filters of pipes, "My tasks" and the search. */
import type { Label, Priority, Task } from "./types";
import { t } from "./i18n.svelte";

/** From 1 (urgent) to 4 (low); names shown with t(). */
export const PRIORITIES: { value: Priority; label: string; color: string }[] = [
  { value: 1, label: "Urgent", color: "#ed2651" },
  { value: 2, label: "High", color: "#f08a24" },
  { value: 3, label: "Medium", color: "#2bc2ff" },
  { value: 4, label: "Low", color: "#8b95a7" },
];

export const priorityOf = (p: Priority | null | undefined) => PRIORITIES.find((x) => x.value === p);
export const priorityName = (p: Priority | null | undefined) => (p ? t(priorityOf(p)!.label) : t("No priority"));

/** Colors offered for a new label. */
export const LABEL_COLORS = ["#ed2651", "#f08a24", "#f5c518", "#2a9d63", "#2bc2ff", "#0366d6", "#8e44ad", "#8b95a7"];

/** Text on a label of this color: dark on light colors, white otherwise. */
export function labelText(color: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#111319" : "#ffffff";
}

export interface TaskFilters {
  /** Label names: a task needs one of them. */
  labels?: string[];
  /** A priority, or 0 for none; undefined for any. */
  priority?: Priority | 0;
  /** An owner's id, or "none" for unassigned. */
  owner?: string;
  type?: string;
}

/** Whether a task passes the filters (labels are compared by name, case ignored). */
export function matches(task: Pick<Task, "labels" | "priority" | "assignee" | "taskType">, f: TaskFilters): boolean {
  if (f.labels?.length) {
    const wanted = new Set(f.labels.map((n) => n.toLowerCase()));
    if (!task.labels.some((l) => wanted.has(l.name.toLowerCase()))) return false;
  }
  if (f.priority !== undefined && (task.priority ?? 0) !== f.priority) return false;
  if (f.owner && (f.owner === "none" ? task.assignee !== null : task.assignee?.id !== f.owner)) return false;
  if (f.type && task.taskType !== f.type) return false;
  return true;
}

/** Most urgent first, tasks without priority last; the order is kept otherwise. */
export const byPriority = <T extends { priority: Priority | null }>(tasks: T[]) =>
  [...tasks].sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));

/** Distinct labels by name, in name order (labels of several spaces). */
export function distinctLabels(labels: Label[]): Label[] {
  const seen = new Map<string, Label>();
  for (const l of labels) if (!seen.has(l.name.toLowerCase())) seen.set(l.name.toLowerCase(), l);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
