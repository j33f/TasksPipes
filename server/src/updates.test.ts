import { describe, expect, it } from "vitest";
import { newer, updateEmail } from "./updates.js";

describe("versions", () => {
  it.each([
    ["0.17.0", "0.16.0", true],
    ["0.16.1", "0.16.0", true],
    ["1.0.0", "0.99.9", true],
    ["0.10.0", "0.9.0", true],
    ["v0.17.0", "0.16.0", true],
    ["0.16.0", "0.16.0", false],
    ["0.15.9", "0.16.0", false],
    ["1.0.0", "1.0.0-rc.1", true],
    ["1.0.0-rc.1", "1.0.0", false],
    ["1.0.0-rc.2", "1.0.0-rc.1", true],
  ])("%s is newer than %s: %s", (a, b, expected) => {
    expect(newer(a, b)).toBe(expected);
  });
});

describe("the e-mail telling of a new version", () => {
  it("names it, the running one and links to its notes, in the administrator's language", () => {
    const en = updateEmail("en", { version: "9.9.9", url: "https://github.com/j33f/TasksPipes/releases/tag/v9.9.9", publishedAt: null });
    expect(en.subject).toBe("TasksPipes 9.9.9 is available");
    expect(en.html).toContain("This instance runs version");
    expect(en.html).toContain('href="https://github.com/j33f/TasksPipes/releases/tag/v9.9.9"');
    expect(updateEmail("fr", { version: "9.9.9", url: "u", publishedAt: null }).subject).toBe("TasksPipes 9.9.9 est disponible");
  });
});
