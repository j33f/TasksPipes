import { describe, expect, it } from "vitest";
import { htmlToText, mailLayout, outlineInvite, type MailTheme } from "./mail.js";

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

describe("the look of the e-mails", () => {
  const mail = (theme: MailTheme = null) =>
    mailLayout("en", { title: "Hello", intro: "Some news", body: "<p>Body text</p>", action: { label: "Open", url: "https://tasks.test/x" }, footer: "Small print", theme });

  it("follows the mail app's light or dark mode, unless the profile forces one", () => {
    const auto = mail();
    expect(auto).toContain('<meta name="color-scheme" content="light dark">');
    expect(auto).toContain("@media (prefers-color-scheme:dark)");
    expect(auto).toContain("#ffffff"); // light card by default
    const dark = mail("dark");
    expect(dark).toContain('<meta name="color-scheme" content="dark">');
    expect(dark).not.toContain("@media");
    expect(dark).toContain("background-color:#181c25"); // dark card inline
  });

  it("gives a plain-text version without styles nor logo", () => {
    const text = htmlToText(mail());
    expect(text).not.toMatch(/@media|tp-|<|color-scheme/);
    expect(text).toContain("Hello");
    expect(text).toContain("Body text");
    expect(text).toContain("Open (https://tasks.test/x)");
    expect(text).toContain("Small print");
  });

  it("escapes what it is given", () => {
    expect(mailLayout("en", { title: "<b>x</b>", body: "" })).toContain("&#60;b&#62;x&#60;/b&#62;");
  });
});
