import { describe, expect, it } from "vitest";
import { outlineInvite } from "./mail.js";

describe("invitation of an Outline colleague", () => {
  it("names who asks and the Outline server to sign in with, in the colleague's language", () => {
    expect(outlineInvite("en", "Alice Martin", "https://docs.example.com")).toEqual({
      subject: "Alice Martin invites you to TasksPipes",
      paragraphs: [
        "Alice Martin would like to share tasks with you on TasksPipes, the task manager that works with your Outline workspace.",
        "Sign in with your Outline account, on the server https://docs.example.com.",
      ],
    });
    expect(outlineInvite("fr", "Alice Martin", "https://docs.example.com").subject).toBe("Alice Martin vous invite sur TasksPipes");
  });
});
