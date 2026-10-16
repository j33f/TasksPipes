import { STATUS_BY_ID, formatDate } from "./constants";
import type { EventSide, TaskEvent } from "./types";

type Loc = NonNullable<EventSide["location"]>;

export const locLabel = (l: Loc | null) =>
  !l ? "—" : l.incoming ? `l'incoming de ${l.spaceName}` : `${l.spaceName} › ${l.pipeName ?? "(pipe supprimé)"}`;

const statusLabel = (s: string | null) => (s ? STATUS_BY_ID[s as keyof typeof STATUS_BY_ID]?.label ?? s : "—");

export function eventSummary(e: TaskEvent): string {
  const to = e.to.location;
  const from = e.from.location;
  switch (e.type) {
    case "created":
      return `a créé la tâche dans ${locLabel(to)}`;
    case "sent":
      return from ? `a envoyé la tâche vers ${locLabel(to)}` : `a créé et envoyé la tâche vers ${locLabel(to)}`;
    case "accepted":
      return `a accepté la tâche dans ${locLabel(to)}`;
    case "moved":
      return `a déplacé la tâche vers ${locLabel(to)}`;
    case "status":
      return `a passé la tâche à « ${statusLabel(e.to.status)} »`;
    case "refused":
      return `a refusé la tâche, renvoyée vers ${locLabel(to)}`;
    case "edited":
      return "a modifié le titre ou la description";
    case "updated":
      return "a mis à jour la tâche";
    case "comment":
      return "a commenté";
    default:
      return e.type;
  }
}

/** Lists the traced fields that changed during an event (or the initial values on creation). */
export function eventChanges(e: TaskEvent): string[] {
  const out: string[] = [];
  const initial = !e.from.location;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (e.type === "comment") return out;

  if (!initial && (e.from.location?.spaceId !== e.to.location?.spaceId || e.from.location?.pipeId !== e.to.location?.pipeId)) {
    out.push(`Emplacement : ${locLabel(e.from.location)} → ${locLabel(e.to.location)}`);
  }
  if (initial ? !e.to.location?.incoming : e.from.status !== e.to.status && !(e.to.location?.incoming)) {
    out.push(initial ? `État : ${statusLabel(e.to.status)}` : `État : ${statusLabel(e.from.status)} → ${statusLabel(e.to.status)}`);
  }
  if (initial ? e.to.assignee : !same(e.from.assignee?.id, e.to.assignee?.id)) {
    out.push(`Propriétaire : ${initial ? "" : `${e.from.assignee?.name ?? "personne"} → `}${e.to.assignee?.name ?? "personne"}`);
  }
  if (initial ? e.to.dueDate : e.from.dueDate !== e.to.dueDate) {
    out.push(`Échéance : ${initial ? "" : `${formatDate(e.from.dueDate) || "aucune"} → `}${formatDate(e.to.dueDate) || "aucune"}`);
  }
  if (initial ? e.to.doc : !same(e.from.doc?.id, e.to.doc?.id)) {
    out.push(`Document Outline : ${initial ? "" : `${e.from.doc?.title ?? "aucun"} → `}${e.to.doc?.title ?? "aucun"}`);
  }
  return out;
}

export function eventIcon(type: TaskEvent["type"]) {
  return (
    { created: "plus", sent: "send", accepted: "check", moved: "arrow", status: "pipe", refused: "return", edited: "edit", updated: "edit", comment: "comment" } as const
  )[type] ?? "history";
}
