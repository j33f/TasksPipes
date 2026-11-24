import { describe, expect, it } from "vitest";
import { dailyDocument, docId, md, mdBlock, sprintDocument } from "./outline-reports.js";

const pipe = { id: "p1", name: "App", kind: "dev" };
const task = (n: number, title: string) => ({ id: `t${n}`, number: n, title, taskType: "task", owner: "Ana", stage: null });

describe("Markdown of reports published to Outline", () => {
  it("escapes what Markdown would read as formatting, on one line", () => {
    expect(md("Fix *bold* [link](x) #1\nnext")).toBe("Fix \\*bold\\* \\[link\\]\\(x\\) \\#1 next");
  });

  it("escapes, at the start of a paragraph, what would open a list, a rule or a heading", () => {
    expect(mdBlock("1. Ship the sign-in")).toBe("1\\. Ship the sign-in");
    expect(mdBlock(" 2) Ship")).toBe("2\\) Ship");
    expect(mdBlock("- first")).toBe("\\- first");
    expect(mdBlock("---")).toBe("\\---");
    expect(mdBlock("=== ok")).toBe("\\=== ok");
    expect(mdBlock("Sign-in in 2027. Then - more")).toBe("Sign-in in 2027. Then - more");
  });

  it("writes a daily report section by section, empty when nothing happened", () => {
    const period = { start: "2026-11-23T18:00:00Z", end: "2026-11-24T18:00:00Z" };
    const none = { period, created: [], started: [], done: [], blocked: [], dropped: [], inProgress: [], stillBlocked: [] };
    expect(dailyDocument(pipe, none, "en", "2026-11-24").empty).toBe(true);
    const doc = dailyDocument(pipe, { ...none, done: [task(4, "Ship_it")] }, "en", "2026-11-24");
    expect(doc.empty).toBe(false);
    expect(doc.title).toMatch(/^Activity of App — Tuesday.*24.*November.*2026$|^Activity of App — Tuesday.*November.*24.*2026$/);
    expect(doc.text).toContain("## Tasks done (1)\n\n- [TP-4](");
    expect(doc.text).toContain(") Ship\\_it · Ana");
    expect(doc.text).not.toContain("Tasks started");
  });

  it("writes a sprint report with its tables", () => {
    const sprint = {
      name: "Sprint 3", goal: "Sign-in", starts_on: "2026-11-09", ends_on: "2026-11-20",
      report: { committed: 13, completed: 8, done: 3, carried: 1, carriedPoints: 5, carriedTo: { name: "Sprint 4" }, scopeStart: 13, scopeEnd: 16,
        byOwner: [{ key: "", done: 1, donePoints: 3, tasks: 2, points: 8 }], velocity: { value: 9, source: "learned" } },
    };
    const doc = sprintDocument(pipe, sprint, "en");
    expect(doc.title).toBe("Sprint 3 of App — report");
    expect(doc.text).toContain("| Carried over | 5 pts · 1 tasks → Sprint 4 |");
    expect(doc.text).toContain("| Added during the sprint | +3 pts |");
    expect(doc.text).toContain("| Velocity for the next sprints | 9 pts |");
    expect(doc.text).toContain("## Done per person\n\n|  | Points done | Tasks done |");
    expect(doc.text).toContain("| Unassigned | 3 / 8 | 1 / 2 |");
  });

  it("takes a parent as an id or a document's address", () => {
    expect(docId("https://docs.example.com/doc/roadmap-AbC123?x=1")).toBe("roadmap-AbC123");
    expect(docId("8d1f2c9e-1b2a-4c3d-9e8f-0a1b2c3d4e5f")).toBe("8d1f2c9e-1b2a-4c3d-9e8f-0a1b2c3d4e5f");
    expect(() => docId("a b")).toThrow();
    expect(() => docId("")).toThrow();
  });
});
