import { afterEach, describe, expect, it } from "vitest";
import { mentionText, typedMention, withMentions } from "./mentions";
import { renderMarkdown } from "../components/Markdown.svelte";
import { app } from "./app.svelte";

const BOB = "22222222-2222-4222-8222-222222222222";
afterEach(() => (app.users = []));

describe("mentions", () => {
  it("link to the person's space when one sees them, else show their name", () => {
    app.users = [{ id: BOB, name: "Bob", avatarUrl: null, spaceId: "space-bob", active: true, guest: false }];
    expect(withMentions(`Hi @[Bob Durand](mention:${BOB})`)).toBe("Hi [@Bob Durand](/spaces/space-bob)");
    expect(withMentions("Hi @[Who](mention:33333333-3333-4333-8333-333333333333)")).toBe("Hi **@Who**");
    // Rendered as a link that stays in the app.
    const html = renderMarkdown(`@[Bob](mention:${BOB})`);
    expect(html).toContain('href="/spaces/space-bob"');
    expect(html).not.toContain("_blank");
  });

  it("keep Markdown out of names", () => {
    expect(withMentions("@[*x*](mention:33333333-3333-4333-8333-333333333333)")).toBe("**@\\*x\\***");
  });

  it("are spotted while typed", () => {
    expect(typedMention("Hello @bo", 9)).toEqual({ start: 6, query: "bo" });
    expect(typedMention("@", 1)).toEqual({ start: 0, query: "" });
    expect(typedMention("mail bob@example", 16)).toBeNull();
    expect(typedMention("Hello @bob done", 15)).toEqual({ start: 6, query: "bob done" });
    expect(mentionText({ id: BOB, name: "Bob [admin]" })).toBe(`@[Bob [admin](mention:${BOB}) `);
  });
});
