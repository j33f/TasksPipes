import { describe, expect, it } from "vitest";
import { sprintEmail } from "./sprint-report.js";

describe("the e-mail of a closed sprint", () => {
  it("tells its goal, points, carried over tasks, what each one did and the next velocity", () => {
    const sprint = {
      name: "Sprint 4", goal: "Sign-in <b>without</b> passwords", starts_on: "2026-11-30", ends_on: "2026-12-11",
      report: {
        committed: 21, completed: 16, done: 4, carried: 1, carriedPoints: 5, abandoned: 0, carriedTo: { name: "Sprint 5" }, scopeStart: 21, scopeEnd: 24,
        byOwner: [{ key: "Ann", done: 3, donePoints: 13, tasks: 3, points: 13 }, { key: "", done: 1, donePoints: 3, tasks: 2, points: 8 }],
        byType: [{ key: "user_story", done: 4, donePoints: 16, tasks: 5, points: 21 }],
        velocity: { value: 18, source: "learned" },
      },
    };
    const mail = sprintEmail({ id: "p", name: "App" }, sprint, "en");
    expect(mail.subject).toBe("Sprint 4 of App is closed");
    for (const text of ["Sign-in &#60;b&#62;without&#60;/b&#62; passwords", "21 pts", "16 pts", "→ Sprint 5", "Added during the sprint", "3 pts", "18 pts", "Ann", "Unassigned", "User story", "From 30 November to 11 December."]) {
      expect(mail.html).toContain(text);
    }
    expect(sprintEmail({ id: "p", name: "App" }, sprint, "fr").subject).toBe("Sprint 4 de App est clôturé");
  });
});
