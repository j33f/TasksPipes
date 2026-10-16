import { app } from "./app.svelte";
import { localDay } from "./constants";
import { t, tn } from "./i18n.svelte";
import type { Column, Status, Task } from "./types";

/** Groups of "my tasks", in the order they are shown (labels shown with t()). */
export const GROUPS: { id: string; label: string; statuses: Status[]; hint: string }[] = [
  { id: "doing", label: "In progress", statuses: ["started", "ongoing"], hint: "Started or under way" },
  { id: "blocked", label: "Blocked", statuses: ["blocked"], hint: "Waiting for someone else or a decision" },
  { id: "ready", label: "Ready to start", statuses: ["ready"], hint: "Everything is there to get going" },
  { id: "later", label: "Coming up", statuses: ["backlog"], hint: "Not ready yet" },
];

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/** First column of the task's pipe with one of these statuses. */
export function columnWith(task: Task, ...statuses: Status[]): Column | undefined {
  const cols = app.columnsFor(task.pipe?.kind);
  for (const s of statuses) {
    const c = cols.find((x) => x.status === s);
    if (c) return c;
  }
}

export interface Suggestion {
  task: Task;
  score: number;
  reasons: string[];
}

/**
 * Ranks the tasks that could be started next (ready or backlog), GTD style:
 * what is late or due soon first, then what is ready, already begun, or waiting for long.
 */
export function suggestions(tasks: Task[]): Suggestion[] {
  const today = localDay();
  return tasks
    .filter((t) => (t.status === "ready" || t.status === "backlog") && columnWith(t, "started", "ongoing"))
    .map((task) => {
      let score = 0;
      const reasons: string[] = [];
      if (task.dueDate) {
        const days = daysBetween(today, task.dueDate);
        if (days < 0) {
          score += 100 + Math.min(-days, 30);
          reasons.push(tn(-days, "{n} day late", "{n} days late"));
        } else if (days === 0) {
          score += 90;
          reasons.push(t("due today"));
        } else if (days <= 7) {
          score += 70 - days * 5;
          reasons.push(days === 1 ? t("due tomorrow") : t("due in {n} days", { n: days }));
        } else {
          score += 10;
        }
      }
      if (task.status === "ready") {
        score += 30;
        reasons.push(t("ready to start"));
      }
      if (task.checklist.done > 0) {
        score += 10;
        reasons.push(t("{done}/{total} sub-tasks already done", { done: task.checklist.done, total: task.checklist.total }));
      }
      const age = daysBetween(task.createdAt.slice(0, 10), today);
      score += Math.min(age, 30) / 3;
      if (age >= 14) reasons.push(t("waiting for {n} days", { n: age }));
      return { task, score, reasons };
    })
    .sort((a, b) => b.score - a.score || a.task.position - b.task.position);
}
