import { describe, expect, it } from "vitest";
import { cleanFields, cleanFieldValue } from "./fields.js";
import type { Field, TaskType } from "./pipeTypes.js";

const f = (type: Field["type"], extra: Partial<Field> = {}): Field => ({ id: "x", label: "X", type, ...extra });
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

describe("cleanFieldValue", () => {
  it("clears empty values", () => {
    for (const v of [null, undefined, ""]) expect(cleanFieldValue(f("text"), v)).toBeNull();
  });

  it("trims text and limits its length", () => {
    expect(cleanFieldValue(f("text"), "  hello ")).toBe("hello");
    expect(err(() => cleanFieldValue(f("text"), "x".repeat(501)))).toBe("{field}: too long");
    expect(cleanFieldValue(f("textarea"), "x".repeat(10_000))).toHaveLength(10_000);
  });

  it("adds https:// to links without a scheme", () => {
    expect(cleanFieldValue(f("url"), "example.com/a")).toBe("https://example.com/a");
    expect(cleanFieldValue(f("url"), "http://example.com")).toBe("http://example.com");
  });

  it("reads numbers written the French way", () => {
    expect(cleanFieldValue(f("money"), "1 234,50")).toBe(1234.5);
    expect(cleanFieldValue(f("number"), 12)).toBe(12);
    expect(err(() => cleanFieldValue(f("number"), "abc"))).toBe("{field}: a number is expected");
  });

  it("checks dates", () => {
    expect(cleanFieldValue(f("date"), "2026-10-16")).toBe("2026-10-16");
    expect(err(() => cleanFieldValue(f("date"), "16/10/2026"))).toBe("{field}: invalid date");
  });

  it("keeps choices among the options, in their order", () => {
    const sel = f("select", { options: ["Oui", "Non"] });
    expect(cleanFieldValue(sel, "Non")).toBe("Non");
    expect(err(() => cleanFieldValue(sel, "Peut-être"))).toBe("{field}: invalid choice");
    const multi = f("multiselect", { options: ["a", "b", "c"] });
    expect(cleanFieldValue(multi, ["c", "a"])).toEqual(["a", "c"]);
    expect(cleanFieldValue(multi, [])).toBeNull();
    expect(err(() => cleanFieldValue(multi, ["z"]))).toBe("{field}: invalid choice");
  });

  it("stores a checkbox only when ticked", () => {
    expect(cleanFieldValue(f("checkbox"), true)).toBe(true);
    expect(cleanFieldValue(f("checkbox"), false)).toBeNull();
  });

  it("checks person ids", () => {
    expect(cleanFieldValue(f("user"), "11111111-1111-4111-8111-111111111111")).toBeTruthy();
    expect(err(() => cleanFieldValue(f("user"), "bob"))).toBe("{field}: invalid person");
  });

  it("normalises RNCP / RS codes", () => {
    expect(cleanFieldValue(f("rncp"), { code: "rncp 37873", title: " Dev " })).toEqual({ code: "RNCP37873", title: "Dev" });
    expect(cleanFieldValue(f("rncp"), "RS-5487")).toEqual({ code: "RS5487", title: null });
    expect(cleanFieldValue(f("rncp"), { code: "", title: "Only a title" })).toEqual({ code: null, title: "Only a title" });
    expect(cleanFieldValue(f("rncp"), { code: "", title: "" })).toBeNull();
    expect(err(() => cleanFieldValue(f("rncp"), "ABC123"))).toBe("{field}: expected a code like RNCP12345 or RS1234");
  });

  it("checks Outline documents and makes their links absolute", () => {
    expect(cleanFieldValue(f("docs"), [{ id: "d1", title: "Doc", url: "/doc/d1" }])).toEqual([
      { id: "d1", title: "Doc", url: "https://outline.test/doc/d1" },
    ]);
    expect(err(() => cleanFieldValue(f("docs"), [{ title: "no id" }]))).toBe("{field}: invalid document");
  });

  it("refuses files (uploaded separately)", () => {
    expect(err(() => cleanFieldValue(f("files"), ["a.pdf"]))).toBe("{field}: files are uploaded separately");
  });
});

describe("cleanFields", () => {
  const type: TaskType = {
    id: "t", label: "T", icon: "check", description: "",
    fields: [f("text", { id: "name", label: "Name" }), f("number", { id: "n", label: "N" })],
  };

  it("returns the cleaned values and the labels of the fields touched", () => {
    expect(cleanFields(type, { name: " A ", n: "3" })).toEqual({ values: { name: "A", n: 3 }, labels: ["Name", "N"] });
  });

  it("refuses unknown fields and non-objects", () => {
    expect(err(() => cleanFields(type, { other: 1 }))).toBe("Unknown field for “{type}”: {id}");
    expect(err(() => cleanFields(type, [1]))).toBe("Invalid fields");
  });
});
