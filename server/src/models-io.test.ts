import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { FORMAT, exportModels, parseModels } from "./models-io.js";

const USER = "11111111-1111-4111-8111-111111111111";
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

describe("exportModels", () => {
  it("writes a pipe type with its columns, referring to built-in task types by id", () => {
    const file = parse(exportModels(["commercial"], [], USER, "en"));
    expect(file.taskspipes).toBe(FORMAT);
    expect(file.taskTypes).toBeUndefined(); // its task types are built in
    expect(file.pipeTypes[0]).toMatchObject({ id: "commercial", label: "Commercial", taskTypes: ["opportunite", "appel_offres"] });
    expect(file.pipeTypes[0].columns[0]).toEqual({ id: "demande", label: "Request", status: "backlog", color: "#66778F" });
  });

  it("writes task types asked for, in the reader's language, choices included", () => {
    const fr = parse(exportModels([], ["accompagnement_psh"], USER, "fr"));
    const en = parse(exportModels([], ["accompagnement_psh"], USER, "en"));
    expect(fr.taskTypes[0].fields.find((f: { id: string }) => f.id === "rqth").options).toEqual(["Oui", "Non"]);
    expect(en.taskTypes[0].fields.find((f: { id: string }) => f.id === "rqth").options).toEqual(["Yes", "No"]);
  });

  it("refuses an export with nothing in it", () => {
    expect(err(() => exportModels(["nope"], [], USER, "en"))).toBe("Nothing to export");
  });
});

describe("parseModels", () => {
  it("reads a model file", () => {
    const file = parseModels(`taskspipes: 1\ntaskTypes:\n  - id: visit\n    label: Visit\npipeTypes:\n  - label: Work-study\n`);
    expect(file.taskTypes).toHaveLength(1);
    expect(file.pipeTypes).toHaveLength(1);
  });

  it("refuses other files", () => {
    expect(err(() => parseModels("a: [1"))).toMatch(/^This file is not valid YAML/);
    expect(err(() => parseModels("just text"))).toBe("This file is not a TasksPipes model file");
    expect(err(() => parseModels("taskspipes: 1\npipeTypes: oops"))).toBe("This file is not a TasksPipes model file");
    expect(err(() => parseModels("taskspipes: 2\npipeTypes: []"))).toBe("Unsupported model file version: {version}");
    expect(err(() => parseModels("taskspipes: 1"))).toBe("This file holds no model");
  });

  it("limits the number of models and YAML aliases", () => {
    const many = `taskspipes: 1\ntaskTypes:\n${"  - label: x\n".repeat(101)}`;
    expect(err(() => parseModels(many))).toBe("{n} models at most per file");
    // A "billion laughs" document: aliases of aliases.
    const bomb = ["a: &a [x,x,x,x,x,x,x,x,x]", ..."bcdefgh".split("").map((c, i) => `${c}: &${c} [${Array(9).fill(`*${"abcdefgh"[i]}`).join(",")}]`)].join("\n");
    expect(err(() => parseModels(`taskspipes: 1\n${bomb}`))).toMatch(/^This file is not valid YAML/);
  });
});
