import { afterEach, describe, expect, it } from "vitest";
import { eventChanges, eventIcon, eventSummary } from "./events";
import { prefs } from "./i18n.svelte";
import type { EventSide, TaskEvent } from "./types";

afterEach(() => prefs.set({ locale: null }));

const side = (over: Partial<EventSide> = {}): EventSide => ({
  location: { spaceId: "s1", spaceName: "Alice", pipeId: "p1", pipeName: "Personal", incoming: false },
  status: "backlog",
  stage: "Backlog",
  assignee: null,
  dueDate: null,
  doc: null,
  ...over,
});
const event = (over: Partial<TaskEvent>): TaskEvent => ({
  id: 1, type: "created", comment: null, details: null, createdAt: "2026-10-16T10:00:00Z",
  actor: { id: "u1", name: "Alice", avatarUrl: null }, from: side({ location: null, status: null as never, stage: null }), to: side(),
  ...over,
});

describe("history texts", () => {
  it("summarise each kind of event", () => {
    prefs.set({ locale: "en" });
    expect(eventSummary(event({}))).toBe("created the task in Alice › Personal");
    expect(eventSummary(event({ type: "status", from: side(), to: side({ stage: "In progress", status: "ongoing" }) }))).toBe("moved the task to “In progress”");
    expect(eventSummary(event({ type: "checklist", details: { item: "Coffee", done: true } }))).toBe("checked “Coffee”");
    expect(eventSummary(event({ type: "refused", to: side({ location: { spaceId: "s2", spaceName: "Bob", pipeId: null, pipeName: null, incoming: true } }) })))
      .toBe("refused the task, sent back to the incoming of Bob");
  });

  it("list what changed, translated", () => {
    prefs.set({ locale: "fr" });
    const changes = eventChanges(event({
      type: "updated", from: side({ dueDate: null }), to: side({ dueDate: "2026-11-02", assignee: { id: "b", name: "Bob" } }),
      details: { fields: ["Montant HT"] },
    }));
    expect(changes).toEqual(expect.arrayContaining(["Propriétaire : personne → Bob", "Informations : Montant HT"]));
    expect(changes.find((c) => c.startsWith("Échéance : aucune →"))).toBeTruthy();
  });

  it("give the initial values on creation", () => {
    prefs.set({ locale: "en" });
    expect(eventChanges(event({}))).toEqual(["Column: Backlog"]);
    expect(eventIcon("comment")).toBe("comment");
  });
});
