import { describe, expect, it } from "vitest";
import { mentionedIds, newMentions } from "./mentions.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("mentions", () => {
  it("are read from the text, each person once", () => {
    expect(mentionedIds(`Hi @[Alice Martin](mention:${A}) and @[Bob](mention:${B}), @[Alice](mention:${A.toUpperCase()})`)).toEqual([A, B]);
    expect(mentionedIds("mail me at bob@example.com, or @Bob")).toEqual([]);
    expect(mentionedIds(`@[Bob](mention:not-an-id)`)).toEqual([]);
    expect(mentionedIds(null)).toEqual([]);
  });

  it("are new when the description did not hold them", () => {
    expect(newMentions(`@[A](mention:${A})`, `@[A](mention:${A}) @[B](mention:${B})`)).toEqual([B]);
    expect(newMentions(`@[A](mention:${A})`, "")).toEqual([]);
  });
});
