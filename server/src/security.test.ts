/** Fixes of code-scanning findings: e-mail check, plain-text e-mails, connections to user-given Outline servers. */
import { describe, expect, it } from "vitest";
import { htmlToText, isEmail } from "./mail.js";
import { publicLookup } from "./outline.js";

describe("e-mail addresses", () => {
  it("are checked", () => {
    for (const ok of ["a@b.co", "first.last@sub.example.org", "x+tag@example.fr"]) expect(isEmail(ok)).toBe(true);
    for (const bad of ["", "a@b", "a@@b.co", "a b@c.de", "a@b..co", "a@.b.co", "@b.co", `${"a".repeat(250)}@b.co`]) expect(isEmail(bad)).toBe(false);
  });

  it("are checked in linear time, whatever the input", () => {
    const evil = `!@!.${"!.".repeat(100_000)}`;
    const start = performance.now();
    expect(isEmail(evil)).toBe(false);
    expect(isEmail(`a@${"b.".repeat(120)}c`)).toBe(true);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe("plain-text version of e-mails", () => {
  it("spells links out and keeps the text", () => {
    expect(htmlToText(`<p>Hello <b>Jane</b></p><ul><li><a href="https://t.test/x">TP-1</a></li></ul>`)).toBe("Hello Jane\n\n- TP-1 (https://t.test/x)");
  });

  it("leaves no tag, even one made of the pieces of others", () => {
    const text = htmlToText("<p>a<scr<script>ipt>alert(1)</scr</script>ipt>b</p>");
    expect(text).not.toMatch(/<|>/);
  });

  it("decodes the escaped characters of user text", () => {
    expect(htmlToText("<p>&#60;3 &#38; co</p>")).toBe("<3 & co");
  });
});

describe("connections to user-given Outline servers", () => {
  const lookup = (host: string, all = false) =>
    new Promise<{ err: (Error & { code?: string }) | null; address: unknown }>((resolve) =>
      publicLookup(host, { all }, (err, address) => resolve({ err, address })));

  it("refuse names resolving to an internal address, when connecting", async () => {
    const { err } = await lookup("localhost");
    expect(err?.code).toBe("EPRIVATE");
    expect((await lookup("localhost", true)).err?.code).toBe("EPRIVATE");
  });
});
