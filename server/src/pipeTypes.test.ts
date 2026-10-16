import { afterEach, describe, expect, it } from "vitest";
import { PIPE_TYPES, TASK_TYPES, pipeTypeById, resolveStage, setCustomTypes, stageLabel, taskTypeById, usableBy, type PipeType } from "./pipeTypes.js";

describe("built-in catalog", () => {
  it("has unique ids, valid task types and a done column in every pipe type", () => {
    const taskIds = new Set(TASK_TYPES.map((t) => t.id));
    expect(taskIds.size).toBe(TASK_TYPES.length);
    expect(new Set(PIPE_TYPES.map((p) => p.id)).size).toBe(PIPE_TYPES.length);
    for (const p of PIPE_TYPES) {
      expect(p.columns.some((c) => c.status === "done"), p.id).toBe(true);
      expect(new Set(p.columns.map((c) => c.id)).size, p.id).toBe(p.columns.length);
      for (const t of p.taskTypes) expect(taskIds.has(t), `${p.id} → ${t}`).toBe(true);
    }
  });

  it("gives select fields at least one option", () => {
    for (const t of TASK_TYPES) for (const f of t.fields) if (f.type === "select" || f.type === "multiselect") expect(f.options?.length, `${t.id}.${f.id}`).toBeGreaterThan(0);
  });
});

describe("resolveStage", () => {
  it("keeps a known column, else picks the column of the status", () => {
    expect(resolveStage("commercial", "devis").id).toBe("devis");
    expect(resolveStage("commercial", "nope", "blocked").id).toBe("financement");
  });

  it("falls back to the nearest status, then the first column", () => {
    // General tasks have no "started" column: started tasks go to "ongoing".
    expect(resolveStage("general", null, "started").id).toBe("ongoing");
    expect(resolveStage("rentree", null, "ready").id).toBe("todo");
    expect(resolveStage("general", null, null).id).toBe("backlog");
  });

  it("uses the general type for an unknown kind", () => {
    expect(resolveStage("does-not-exist", null, "done").id).toBe("done");
    expect(stageLabel("commercial", "perdu")).toBe("Perdu");
    expect(stageLabel(null, "perdu")).toBeNull();
  });
});

describe("custom types", () => {
  afterEach(() => setCustomTypes([], []));

  const custom = (visibility: "private" | "public"): PipeType => ({
    id: "c1", label: "C", group: "G", description: "", color: "#000000", icon: "pipe",
    columns: [{ id: "a", label: "A", color: "#000000", status: "done" }], taskTypes: [], templates: [],
    custom: true, visibility, createdBy: { id: "me", name: "Me" },
  });

  it("are found next to the built-in ones", () => {
    setCustomTypes([custom("public")], [{ id: "ct", label: "CT", icon: "check", description: "", fields: [] }]);
    expect(pipeTypeById("c1")?.label).toBe("C");
    expect(taskTypeById("ct")?.label).toBe("CT");
  });

  it("are usable by their author only while private", () => {
    expect(usableBy(custom("private"), "me")).toBe(true);
    expect(usableBy(custom("private"), "other")).toBe(false);
    expect(usableBy(custom("public"), "other")).toBe(true);
    expect(usableBy(PIPE_TYPES[0], "anyone")).toBe(true);
  });
});
