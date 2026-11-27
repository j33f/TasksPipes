import { describe, expect, it } from "vitest";
import { cleanProposal, parseAnswer } from "./assistant.js";
import type { Field } from "./pipeTypes.js";

const fields: Field[] = [
  { id: "role", label: "En tant que…", type: "text" },
  { id: "severite", label: "Sévérité", type: "select", options: ["Bloquant", "Mineur"] },
  { id: "debut", label: "Début", type: "date" },
];
const task = { title: "Save", description: "Old", fields: { role: "admin" } };

describe("the assistant's answer", () => {
  it("is found even inside a code block or a sentence", () => {
    expect(parseAnswer('Here it is:\n```json\n{"title": "A"}\n```')).toEqual({ title: "A" });
    expect(() => parseAnswer("I cannot do that.")).toThrow("The AI's answer could not be read");
    expect(() => parseAnswer("[1, 2]")).toThrow();
  });

  it("keeps only what changes and what the fields accept", () => {
    const p = cleanProposal({
      title: "  Ctrl+Enter saves  ", description: "Old", notes: " Missing: the version. ",
      fields: { role: "admin", severite: "Grave", debut: "2026-12-01", unknown: "x" },
    }, task, fields);
    expect(p).toEqual({ title: "Ctrl+Enter saves", fields: { debut: "2026-12-01" }, notes: "Missing: the version." });
  });

  it("keeps a valid choice, and nothing for an empty answer", () => {
    expect(cleanProposal({ fields: { severite: "Mineur" } }, task, fields)).toEqual({ fields: { severite: "Mineur" } });
    expect(cleanProposal({ title: null, description: "", fields: null }, task, fields)).toEqual({});
  });
});
