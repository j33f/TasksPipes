import { STATUS_BY_ID, formatDate } from "./constants";
import type { EventSide, TaskEvent } from "./types";
import { t } from "./i18n.svelte";
import { gitKindLabel } from "./git";
import { priorityName } from "./labels";

/** "#12 “Title”" for a pull/merge request, "“Title”" for a commit. */
const gitRef = (e: TaskEvent) => {
  const d = e.details;
  const num = d?.number ? `${d.kind === "merge_request" ? "!" : "#"}${d.number} ` : "";
  return `${num}“${d?.title ?? ""}”`;
};

/** What a pull/merge request did (GitHub / GitLab actions, shown with t()). */
export const GIT_ACTIONS: Record<string, string> = {
  opened: "opened", reopened: "reopened", ready_for_review: "ready for review", converted_to_draft: "back to draft",
  merged: "merged", closed: "closed", pushed: "pushed", update: "updated",
};

type Loc = NonNullable<EventSide["location"]>;

export const locLabel = (l: Loc | null) =>
  !l ? "—" : l.incoming ? t("the incoming of {name}", { name: l.spaceName }) : `${l.spaceName} › ${l.pipeName ?? t("(deleted pipe)")}`;

const statusLabel = (s: string | null) => (s ? t(STATUS_BY_ID[s as keyof typeof STATUS_BY_ID]?.label ?? s) : "—");

export function eventSummary(e: TaskEvent): string {
  const to = e.to.location;
  const from = e.from.location;
  switch (e.type) {
    case "created":
      return t("created the task in {place}", { place: locLabel(to) });
    case "sent":
      return from ? t("sent the task to {place}", { place: locLabel(to) }) : t("created and sent the task to {place}", { place: locLabel(to) });
    case "accepted":
      return t("accepted the task in {place}", { place: locLabel(to) });
    case "moved":
      return t("moved the task to {place}", { place: locLabel(to) });
    case "status":
      return t("moved the task to “{column}”", { column: e.to.stage ?? statusLabel(e.to.status) });
    case "refused":
      return t("refused the task, sent back to {place}", { place: locLabel(to) });
    case "edited":
      return t("changed the title or description");
    case "updated":
      return t("updated the task");
    case "comment":
      return t("commented");
    case "fields":
      return t("updated the details");
    case "file":
      return e.details?.added
        ? t("added the file “{name}”", { name: e.details.added })
        : t("removed the file “{name}”", { name: e.details?.removed ?? "" });
    case "linked":
      return t("linked the {kind} {ref}", { kind: gitKindLabel(e.details?.kind ?? "commit"), ref: gitRef(e) });
    case "dependency":
      return e.details?.dependency === "removed" ? t("removed a task it waited for") : t("added a task it waits for");
    case "checklist":
      return t(e.details?.done ? "checked “{item}”" : "unchecked “{item}”", { item: e.details?.item ?? "" });
    default:
      return e.type;
  }
}

/** Lists the traced fields that changed during an event (or the initial values on creation). */
export function eventChanges(e: TaskEvent): string[] {
  const out: string[] = [];
  const initial = !e.from.location;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (e.type === "comment" || e.type === "checklist") return out;
  if (e.type === "file") return e.details?.field ? [t("Field: {name}", { name: e.details.field })] : out;

  if (!initial && (e.from.location?.spaceId !== e.to.location?.spaceId || e.from.location?.pipeId !== e.to.location?.pipeId)) {
    out.push(t("Place: {from} → {to}", { from: locLabel(e.from.location), to: locLabel(e.to.location) }));
  }
  if (initial ? !e.to.location?.incoming : e.from.status !== e.to.status && !(e.to.location?.incoming)) {
    const label = (side: typeof e.to) => side.stage ?? statusLabel(side.status);
    out.push(initial ? t("Column: {to}", { to: label(e.to) }) : t("Column: {from} → {to}", { from: label(e.from), to: label(e.to) }));
  }
  if (initial ? e.to.assignee : !same(e.from.assignee?.id, e.to.assignee?.id)) {
    const who = (a: { name: string } | null) => a?.name ?? t("nobody");
    out.push(initial ? t("Owner: {to}", { to: who(e.to.assignee) }) : t("Owner: {from} → {to}", { from: who(e.from.assignee), to: who(e.to.assignee) }));
  }
  if (initial ? e.to.dueDate : e.from.dueDate !== e.to.dueDate) {
    const due = (d: string | null) => formatDate(d) || t("none");
    out.push(initial ? t("Due date: {to}", { to: due(e.to.dueDate) }) : t("Due date: {from} → {to}", { from: due(e.from.dueDate), to: due(e.to.dueDate) }));
  }
  if (initial ? e.to.doc : !same(e.from.doc?.id, e.to.doc?.id)) {
    const doc = (d: { title: string } | null) => d?.title ?? t("no document");
    out.push(initial ? t("Outline document: {to}", { to: doc(e.to.doc) }) : t("Outline document: {from} → {to}", { from: doc(e.from.doc), to: doc(e.to.doc) }));
  }
  if (e.type === "status" && e.details?.url) {
    out.push(t("{kind} {ref}: {action}", {
      kind: gitKindLabel(e.details.kind ?? "pull_request"), ref: gitRef(e), action: t(GIT_ACTIONS[e.details.action ?? ""] ?? e.details.action ?? ""),
    }));
  }
  if (e.details?.whileBlocked) out.push(t("While it still waited for other tasks"));
  if (e.details?.priority) out.push(t("Priority: {from} → {to}", { from: priorityName(e.details.priority.from), to: priorityName(e.details.priority.to) }));
  if (e.details?.labels?.added.length) out.push(t("Labels added: {names}", { names: e.details.labels.added.join(", ") }));
  if (e.details?.labels?.removed.length) out.push(t("Labels removed: {names}", { names: e.details.labels.removed.join(", ") }));
  if (e.details?.taskType) out.push(t("Type: {from} → {to}", { from: e.details.taskType.from, to: e.details.taskType.to }));
  if (e.details?.fields?.length) out.push(t("Details: {fields}", { fields: e.details.fields.join(", ") }));
  return out;
}

export function eventIcon(type: TaskEvent["type"]) {
  return (
    { created: "plus", sent: "send", accepted: "check", moved: "arrow", status: "pipe", refused: "return", edited: "edit", updated: "edit", comment: "comment", fields: "edit", file: "doc", checklist: "checklist", linked: "branch", dependency: "link" } as const
  )[type] ?? "history";
}
