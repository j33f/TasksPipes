import { app } from "./app.svelte";
import { localDay } from "./constants";
import type { Column, Status, Task } from "./types";

/** Groups of "my tasks", in the order they are shown. */
export const GROUPS: { id: string; label: string; statuses: Status[]; hint: string }[] = [
  { id: "doing", label: "En cours", statuses: ["started", "ongoing"], hint: "Démarrées ou en cours" },
  { id: "blocked", label: "Bloquées", statuses: ["blocked"], hint: "En attente d'un tiers ou d'une décision" },
  { id: "ready", label: "Prêtes à démarrer", statuses: ["ready"], hint: "Tout est là pour s'y mettre" },
  { id: "later", label: "À venir", statuses: ["backlog"], hint: "Pas encore prêtes" },
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
          reasons.push(`en retard de ${-days} jour${days < -1 ? "s" : ""}`);
        } else if (days === 0) {
          score += 90;
          reasons.push("échéance aujourd'hui");
        } else if (days <= 7) {
          score += 70 - days * 5;
          reasons.push(days === 1 ? "échéance demain" : `échéance dans ${days} jours`);
        } else {
          score += 10;
        }
      }
      if (task.status === "ready") {
        score += 30;
        reasons.push("prête à démarrer");
      }
      if (task.checklist.done > 0) {
        score += 10;
        reasons.push(`${task.checklist.done}/${task.checklist.total} sous-tâches déjà faites`);
      }
      const age = daysBetween(task.createdAt.slice(0, 10), today);
      score += Math.min(age, 30) / 3;
      if (age >= 14) reasons.push(`en attente depuis ${age} jours`);
      return { task, score, reasons };
    })
    .sort((a, b) => b.score - a.score || a.task.position - b.task.position);
}
