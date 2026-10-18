import { describe, expect, it } from "vitest";
import { parseDate, parseItems, planImport, suggestTarget, trelloRows, TRELLO_MAPPING, type Person } from "./pipe-io.js";

const people: Person[] = [{ id: "u-bob", name: "Bob Durand", email: "bob@example.com" }];

describe("import of a CSV file", () => {
  it("suggests targets from headers, in English, French or other tools' words", () => {
    expect(["Title", "Titre", "Name", "Colonne", "List", "Échéance", "Due date", "Propriétaire", "Sous-tâches", "Notes", "Whatever"]
      .map((h) => suggestTarget(h, "general"))).toEqual(["title", "title", "title", "column", "column", "dueDate", "dueDate", "owner", "items", "description", "ignore"]);
    // A field of the pipe's task types, by its label.
    expect(suggestTarget("Financement", "commercial")).toBe("field:financement");
  });

  it("reads dates, ISO or day first", () => {
    expect(parseDate("2026-03-09")).toBe("2026-03-09");
    expect(parseDate("9/3/2026")).toBe("2026-03-09");
    expect(parseDate("09.03.2026")).toBe("2026-03-09");
    expect(parseDate("")).toBeNull();
    expect(parseDate("31/02/2026")).toBeUndefined();
    expect(parseDate("tomorrow")).toBeUndefined();
  });

  it("reads sub-tasks, done ones marked [x]", () => {
    expect(parseItems("[x] Book\n[ ] Call\nPrint")).toEqual([
      { text: "Book", done: true }, { text: "Call", done: false }, { text: "Print", done: false },
    ]);
  });

  it("checks every line and numbers errors as in the file", () => {
    const rows = [
      ["Title", "Column", "Owner", "Due date", "Financement"],
      ["Good", "", "Bob Durand", "2026-01-02", "opco"],
      ["", "", "", "", ""],
      ["No such column", "Elsewhere", "", "", ""],
      ["Stranger", "", "Mallory", "", ""],
      ["Bad date", "", "", "someday", ""],
      ["Bad choice", "", "", "", "Bitcoin"],
    ];
    const plan = planImport("commercial", "en", { rows, taskType: "opportunite" }, people, null);
    // The empty line 3 is skipped.
    expect(plan.tasks.map((t) => t.line)).toEqual([2]);
    expect(plan.tasks[0]).toMatchObject({ title: "Good", assigneeId: "u-bob", dueDate: "2026-01-02", fields: { financement: "OPCO" } });
    expect(plan.errors).toEqual([
      { line: 4, message: "Unknown column “Elsewhere”: choose where it goes" },
      { line: 5, message: "Mallory is not a member of this space" },
      { line: 6, message: "Invalid due date: someday" },
      { line: 7, message: "Funding: invalid choice" },
    ]);
    expect(plan.columnValues).toEqual([{ value: "Elsewhere", column: "" }]);
  });

  it("puts unknown column values where chosen", () => {
    const rows = [["Title", "Column"], ["A", "Doing"]];
    const plan = planImport("general", "en", { rows, columnValues: { Doing: "ongoing" } }, people, null);
    expect(plan.errors).toEqual([]);
    expect(plan.tasks[0]).toMatchObject({ stage: "ongoing", status: "ongoing" });
  });

  it("needs a title column, and owners only in personal spaces' holder", () => {
    expect(planImport("general", "en", { rows: [["Notes"], ["x"]] }, people, null).errors[0]).toEqual({ line: 1, message: "No column holds the title" });
    const plan = planImport("general", "fr", { rows: [["Titre", "Propriétaire"], ["A", "Bob Durand"]] }, people, "u-alice");
    expect(plan.errors[0].message).toMatch(/^Une tâche/);
  });
});

describe("import of a Trello board", () => {
  const board = {
    lists: [{ id: "l1", name: "To Do" }, { id: "l2", name: "Old", closed: true }],
    cards: [
      { id: "c1", name: "Card", desc: "Text", idList: "l1", due: "2026-05-01T10:00:00.000Z" },
      { id: "c2", name: "Archived", idList: "l1", closed: true },
      { id: "c3", name: "In a closed list", idList: "l2" },
    ],
    checklists: [{ id: "k", idCard: "c1", checkItems: [{ name: "Second", state: "incomplete", pos: 2 }, { name: "First", state: "complete", pos: 1 }] }],
    actions: [{ type: "commentCard", date: "2026-04-01T08:00:00Z", data: { text: "Looks good", card: { id: "c1" } }, memberCreator: { fullName: "Tim" } }],
  };

  it("keeps open cards of open lists, with checklists and comments", () => {
    const rows = trelloRows(board, "en");
    expect(rows).toHaveLength(2);
    expect(rows[1].slice(0, 5)).toEqual(["Card", "Text", "To Do", "2026-05-01", "[x] First\n[ ] Second"]);
    // "To Do" is no column of the pipe: the list is placed by hand.
    const unplaced = planImport("general", "en", { rows, mapping: TRELLO_MAPPING }, people, null);
    expect(unplaced.columnValues).toEqual([{ value: "To Do", column: "" }]);
    const plan = planImport("general", "en", { rows, mapping: TRELLO_MAPPING, columnValues: { "To Do": "ready" } }, people, null);
    expect(plan.errors).toEqual([]);
    expect(plan.tasks[0]).toMatchObject({ stage: "ready", dueDate: "2026-05-01" });
    expect(plan.tasks[0]).toMatchObject({ title: "Card", items: [{ text: "First", done: true }, { text: "Second", done: false }] });
    expect(plan.tasks[0].comments).toEqual(["Tim on Trello, 2026-04-01:\n\nLooks good"]);
  });

  it("refuses anything else", () => {
    expect(() => trelloRows({ hello: 1 }, "en")).toThrow("This is not a Trello board exported as JSON");
  });
});
