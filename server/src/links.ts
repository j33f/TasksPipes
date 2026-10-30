import { config } from "./config.js";

/**
 * Where a document linked to a pipe lives, found from its address: Outline (the instance's server), office suites,
 * file storage, design tools, code forges… or any other page ("link"). The web app knows the same rules
 * (web/src/lib/links.ts) to show the source while the address is typed.
 */
export type LinkSource =
  | "outline"
  | "google_docs"
  | "google_sheets"
  | "google_slides"
  | "google_drive"
  | "onedrive"
  | "dropbox"
  | "notion"
  | "confluence"
  | "figma"
  | "miro"
  | "canva"
  | "github"
  | "gitlab"
  | "link";

const is = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function linkSource(address: string, outlineUrl = config.outlineUrl): LinkSource {
  let u: URL;
  try {
    u = new URL(address);
  } catch {
    return "link";
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  if (outlineUrl && address.startsWith(`${outlineUrl}/`)) return "outline";
  if (host === "docs.google.com") {
    if (path.startsWith("/document")) return "google_docs";
    if (path.startsWith("/spreadsheets")) return "google_sheets";
    if (path.startsWith("/presentation")) return "google_slides";
    return "google_drive";
  }
  if (host === "drive.google.com") return "google_drive";
  if (is(host, "onedrive.live.com") || is(host, "onedrive.com") || host === "1drv.ms" || is(host, "sharepoint.com")) return "onedrive";
  if (is(host, "dropbox.com")) return "dropbox";
  if (is(host, "notion.so") || is(host, "notion.site")) return "notion";
  if (is(host, "atlassian.net")) return "confluence";
  if (is(host, "figma.com")) return "figma";
  if (is(host, "miro.com")) return "miro";
  if (is(host, "canva.com")) return "canva";
  if (is(host, "github.com")) return "github";
  if (is(host, "gitlab.com") || host.startsWith("gitlab.")) return "gitlab";
  return "link";
}
