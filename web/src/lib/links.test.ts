import { describe, expect, it } from "vitest";
import { linkSource, sourcesFor } from "./links";

describe("links of a pipe", () => {
  it("find their source as the server does", () => {
    expect(linkSource("https://outline.test/doc/x", "https://outline.test")).toBe("outline");
    expect(linkSource("https://docs.google.com/spreadsheets/d/1/edit")).toBe("google_sheets");
    expect(linkSource("https://1drv.ms/w/s!a")).toBe("onedrive");
    expect(linkSource("https://www.figma.com/file/x")).toBe("figma");
    expect(linkSource("https://gitlab.acme.fr/x")).toBe("gitlab");
    expect(linkSource("https://example.com")).toBe("link");
    expect(linkSource("nope")).toBe("link");
  });

  it("offer sources fitting the pipe type, always ending with any other link", () => {
    expect(sourcesFor("dev", true).slice(0, 2)).toEqual(["github", "gitlab"]);
    expect(sourcesFor("design", true)[0]).toBe("figma");
    expect(sourcesFor("general", true)[0]).toBe("outline");
    expect(sourcesFor(undefined, true).at(-1)).toBe("link");
  });

  it("leave Outline out where it is not available", () => {
    expect(sourcesFor("general", false)).not.toContain("outline");
    expect(sourcesFor("general", false)[0]).toBe("google_docs");
  });
});
