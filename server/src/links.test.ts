import { describe, expect, it } from "vitest";
import { linkSource } from "./links.js";

describe("the source of a linked document", () => {
  it.each([
    ["https://outline.example.com/doc/brief-abc", "outline"],
    ["https://docs.google.com/document/d/1x/edit", "google_docs"],
    ["https://docs.google.com/spreadsheets/d/1x/edit", "google_sheets"],
    ["https://docs.google.com/presentation/d/1x/edit", "google_slides"],
    ["https://drive.google.com/drive/folders/1x", "google_drive"],
    ["https://onedrive.live.com/edit?id=1", "onedrive"],
    ["https://1drv.ms/w/s!abc", "onedrive"],
    ["https://acme-my.sharepoint.com/:w:/p/x", "onedrive"],
    ["https://www.dropbox.com/scl/fi/x", "dropbox"],
    ["https://www.notion.so/acme/Page-1", "notion"],
    ["https://acme.atlassian.net/wiki/spaces/X", "confluence"],
    ["https://www.figma.com/design/abc/Site", "figma"],
    ["https://miro.com/app/board/x", "miro"],
    ["https://www.canva.com/design/x", "canva"],
    ["https://github.com/acme/site", "github"],
    ["https://gitlab.com/acme/site", "gitlab"],
    ["https://gitlab.acme.fr/team/site", "gitlab"],
    ["https://example.com/page", "link"],
    ["https://notgithub.com/x", "link"],
    ["not a url", "link"],
  ])("%s is %s", (url, source) => {
    expect(linkSource(url, "https://outline.example.com")).toBe(source);
  });

  it("is a plain link on another Outline server", () => {
    expect(linkSource("https://other-outline.example.com/doc/x", "https://outline.example.com")).toBe("link");
  });
});
