import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS, cleanPrefs, describe as describeLine, dueEmail, immediateEmail, isConfidential, prefsOf, unsubscribeUrl, verifyUnsubscribe,
  type NotificationLine,
} from "./notifications.js";

const task = (over: Record<string, unknown> = {}) => ({
  id: "0190a0b0-0000-7000-8000-000000000001", number: 42, title: "Call the client", pipe_id: "p", pipe_kind: "general",
  pipe_name: "Sales", space_name: "Team A", stage: null, task_type: "task", due_date: "2026-10-17", ...over,
});
const line = (over: Partial<NotificationLine> = {}): NotificationLine => ({
  kind: "comment", type: "comment", comment: "Secret detail", actorName: "Alice", toSpaceName: null, toPersonal: false, ...over,
});

describe("notification preferences", () => {
  it("default to e-mails at once for tasks, a digest for comments, reminders at 8:00", () => {
    expect(prefsOf(null)).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toMatchObject({ received: "immediate", comment: "digest", due: "immediate", dueHour: 8 });
  });

  it("keep valid choices and ignore the rest", () => {
    expect(prefsOf({ comment: "off", received: "digest", dueHour: 7, assigned: "loud", due: "digest" })).toEqual({
      ...DEFAULT_PREFS, comment: "off", received: "digest", dueHour: 7,
    });
  });

  it("refuse invalid changes", () => {
    expect(cleanPrefs({ comment: "off", dueHour: 6 })).toEqual({ comment: "off", dueHour: 6 });
    for (const bad of [{ comment: "never" }, { dueHour: 24 }, { dueHour: 7.5 }, { due: "digest" }, { other: "off" }, null]) {
      expect(() => cleanPrefs(bad)).toThrow("Invalid notification settings");
    }
  });
});

describe("unsubscribe links", () => {
  const user = "0190a0b0-0000-7000-8000-0000000000aa";

  it("are signed for one person and the kinds they name", () => {
    const url = new URL(unsubscribeUrl(user, ["refused", "comment", "comment"]));
    const [u, k, s] = ["u", "k", "s"].map((p) => url.searchParams.get(p));
    expect(k).toBe("comment,refused");
    expect(verifyUnsubscribe(u, k, s)).toEqual({ userId: user, kinds: ["comment", "refused"] });
  });

  it("cannot be changed to another person or kind", () => {
    const url = new URL(unsubscribeUrl(user, ["comment"]));
    const s = url.searchParams.get("s");
    expect(verifyUnsubscribe("0190a0b0-0000-7000-8000-0000000000bb", "comment", s)).toBeNull();
    expect(verifyUnsubscribe(user, "comment,due", s)).toBeNull();
    expect(verifyUnsubscribe(user, "comment", `${s}x`)).toBeNull();
    expect(verifyUnsubscribe(user, "nothing", s)).toBeNull();
    expect(verifyUnsubscribe(user, "comment", undefined)).toBeNull();
  });
});

describe("notification e-mails", () => {
  it("tell what happened, with the comment", () => {
    expect(describeLine("en", line(), false)).toBe("Alice commented: “Secret detail”");
    expect(describeLine("fr", line(), false)).toBe("Alice a commenté : « Secret detail »");
    expect(describeLine("en", line({ kind: "received", toPersonal: true, comment: null }), false)).toBe("Alice sent you this task");
    expect(describeLine("en", line({ kind: "received", toSpaceName: "Team A", comment: null }), false)).toBe("Alice sent this task to the incoming of Team A");
  });

  it("give the task, its place and a link", () => {
    const { subject, html } = immediateEmail("en", task(), [line()], "https://tasks.test/notifications/unsubscribe?x");
    expect(subject).toBe("New comment on TP-42 Call the client");
    expect(html).toContain("Team A › Sales");
    expect(html).toContain("https://tasks.test/?task=0190a0b0-0000-7000-8000-000000000001");
    expect(html).toContain("Unsubscribe");
  });

  it("only name confidential tasks by their key, without user text", () => {
    const t = task({ pipe_kind: "suivi", pipe_name: "Learner Jane Doe", title: "Jane's situation" });
    expect(isConfidential(t)).toBe(true);
    const { subject, html } = immediateEmail("en", t, [line(), line({ kind: "refused", comment: "Private reason" })], "u");
    expect(subject).toBe("Activity on TP-42");
    for (const secret of ["Jane", "Secret detail", "Private reason", "Learner"]) expect(html).not.toContain(secret);
    const due = dueEmail("en", "2026-10-17", { overdue: [], today: [t], tomorrow: [] }, "u");
    expect(due.html).not.toContain("Jane");
  });

  it("treat tasks of a confidential type outside any pipe as confidential", () => {
    expect(isConfidential(task({ pipe_id: null, pipe_kind: null, task_type: "accompagnement_psh" }))).toBe(true);
    expect(isConfidential(task({ pipe_id: null, pipe_kind: null, task_type: "task" }))).toBe(false);
  });
});
