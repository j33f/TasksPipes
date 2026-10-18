import { describe, expect, it } from "vitest";
import { CUSTOM_GROUP, validatePipeType, validateTaskType } from "./designer.js";
import type { TaskType } from "./pipeTypes.js";

const USER = "11111111-1111-4111-8111-111111111111";
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};
const columns = [
  { label: "À faire", status: "backlog" },
  { label: "Fait", status: "done" },
];

describe("validatePipeType", () => {
  it("fills defaults and makes column ids from their labels", () => {
    const t = validatePipeType({ label: " Alternance ", columns }, USER);
    expect(t).toMatchObject({ label: "Alternance", group: CUSTOM_GROUP, visibility: "private", icon: "pipe", color: "#2BC2FF" });
    expect(t.columns.map((c) => c.id)).toEqual(["a_faire", "fait"]);
  });

  it("keeps given column ids and dedupes generated ones", () => {
    const t = validatePipeType({ label: "X", columns: [{ id: "keep", label: "A", status: "backlog" }, { label: "Same", status: "done" }, { label: "Same", status: "done" }] }, USER);
    expect(t.columns.map((c) => c.id)).toEqual(["keep", "same", "same_2"]);
  });

  it("keeps an optional work in progress limit per column", () => {
    const t = validatePipeType({ label: "X", columns: [{ label: "Doing", status: "ongoing", wipLimit: 3 }, { label: "Done", status: "done", wipLimit: "" }] }, USER);
    expect(t.columns.map((c) => c.wipLimit)).toEqual([3, undefined]);
    for (const wipLimit of [0, 1000, 2.5, "many"]) {
      expect(() => validatePipeType({ label: "X", columns: [{ label: "A", status: "ongoing", wipLimit }, { label: "B", status: "done" }] }, USER))
        .toThrow("Column {n}: the limit is a number from 1 to 999");
    }
  });

  it("needs two columns, one of them done", () => {
    expect(err(() => validatePipeType({ label: "X", columns: columns.slice(0, 1) }, USER))).toBe("At least two columns are needed");
    expect(err(() => validatePipeType({ label: "X", columns: [columns[0], columns[0]] }, USER))).toBe("At least one “done” column is needed");
    expect(err(() => validatePipeType({ label: "X", columns: [{ label: "A", status: "nope" }, columns[1]] }, USER))).toBe("Column {n}: invalid state");
  });

  it("checks offered task types and drops the plain task", () => {
    expect(validatePipeType({ label: "X", columns, taskTypes: ["task", "cours", "cours"] }, USER).taskTypes).toEqual(["cours"]);
    expect(err(() => validatePipeType({ label: "X", columns, taskTypes: ["nope"] }, USER))).toBe("Unknown task type: {id}");
  });

  it("makes a team-only type confidential", () => {
    expect(validatePipeType({ label: "X", columns, teamOnly: true }, USER)).toMatchObject({ teamOnly: true, confidential: true });
  });

  it("refuses a bad colour and a missing name", () => {
    expect(err(() => validatePipeType({ label: "X", columns, color: "red" }, USER))).toBe("Invalid colour");
    expect(err(() => validatePipeType({ columns }, USER))).toBe("{label} is required");
  });
});

describe("validateTaskType", () => {
  it("needs choices for list fields and keeps hints", () => {
    expect(err(() => validateTaskType({ label: "V", fields: [{ label: "R", type: "select", options: [] }] }))).toBe("Field “{name}”: add at least one choice");
    const t = validateTaskType({ label: "V", fields: [{ label: "Résultat", type: "select", options: ["OK", "OK", " Ko "], hint: "h" }] });
    expect(t.fields[0]).toEqual({ id: "resultat", label: "Résultat", type: "select", options: ["OK", "Ko"], hint: "h" });
  });

  it("refuses an unknown field type", () => {
    expect(err(() => validateTaskType({ label: "V", fields: [{ label: "A", type: "color" }] }))).toBe("Field “{name}”: invalid type");
  });

  it("does not let a saved field change its type", () => {
    const previous: TaskType = { id: "t", label: "V", icon: "check", description: "", fields: [{ id: "a", label: "A", type: "text" }] };
    expect(err(() => validateTaskType({ label: "V", fields: [{ id: "a", label: "A", type: "number" }] }, previous))).toMatch(/can no longer change/);
    expect(validateTaskType({ label: "V", fields: [{ id: "a", label: "A2", type: "text" }] }, previous).fields[0].label).toBe("A2");
  });
});
