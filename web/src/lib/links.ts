import type { LinkSource } from "./types";
import type { IconName } from "../components/Icon.svelte";

/**
 * Sources of the documents linked to a pipe, found from their address with the rules of the server
 * (server/src/links.ts), to show the source while the address is typed.
 */
export const LINK_SOURCES: Record<LinkSource, { label: string; icon: IconName; color: string }> = {
  outline: { label: "Outline", icon: "doc", color: "#0366d6" },
  google_docs: { label: "Google Docs", icon: "doc", color: "#4285f4" },
  google_sheets: { label: "Google Sheets", icon: "chart", color: "#0f9d58" },
  google_slides: { label: "Google Slides", icon: "play", color: "#f4b400" },
  google_drive: { label: "Google Drive", icon: "folder", color: "#1fa463" },
  onedrive: { label: "OneDrive / SharePoint", icon: "folder", color: "#0078d4" },
  dropbox: { label: "Dropbox", icon: "folder", color: "#0061ff" },
  notion: { label: "Notion", icon: "book", color: "#37352f" },
  confluence: { label: "Confluence", icon: "book", color: "#1868db" },
  figma: { label: "Figma", icon: "star", color: "#a259ff" },
  miro: { label: "Miro", icon: "edit", color: "#e6b800" },
  canva: { label: "Canva", icon: "star", color: "#00c4cc" },
  github: { label: "GitHub", icon: "branch", color: "#6e5494" },
  gitlab: { label: "GitLab", icon: "branch", color: "#fc6d26" },
  link: { label: "Other link", icon: "link", color: "" },
};

const is = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function linkSource(address: string, outlineUrl?: string | null): LinkSource {
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

type Offered = Exclude<LinkSource, "link">;
const OFFICE: Offered[] = ["outline", "google_docs", "google_sheets", "onedrive", "google_drive", "dropbox", "notion"];
const SOFTWARE: Offered[] = ["github", "gitlab", "outline", "figma", "google_docs", "notion", "confluence"];
const DESIGN: Offered[] = ["figma", "miro", "canva", "outline", "google_docs", "google_slides"];
const DOCS: Offered[] = ["outline", "google_docs", "notion", "confluence", "onedrive", "github", "gitlab"];
const PERSONAL: Offered[] = ["google_docs", "google_sheets", "google_drive", "onedrive", "dropbox", "notion"];

/** Sources offered first for a pipe type (any other address can still be linked as "Other link"). */
const BY_KIND: Record<string, Offered[]> = {
  dev: SOFTWARE,
  rnd: SOFTWARE,
  qa: ["github", "gitlab", "google_sheets", "outline", "notion", "confluence"],
  ux: ["figma", "miro", "outline", "google_docs", "google_sheets", "notion"],
  design: DESIGN,
  doc_produit: DOCS,
  documentation: DOCS,
  pedagogie: ["outline", "google_docs", "google_slides", "onedrive", "canva", "google_drive"],
  communication: ["canva", "figma", "google_docs", "google_slides", "outline", "onedrive"],
  ...Object.fromEntries(
    ["menage_coloc", "menage_couple", "menage_famille", "demenagement", "garde_alternee", "travaux", "fete", "recherche_emploi",
      "recherche_logement", "sante", "papiers", "voyage"].map((k) => [k, PERSONAL])
  ),
};

/** The sources to choose from when linking a document to a pipe of this type; Outline only where it is on. */
export function sourcesFor(kind: string | undefined, outline: boolean): LinkSource[] {
  const list = (kind && BY_KIND[kind]) || OFFICE;
  return [...list.filter((s) => outline || s !== "outline"), "link"];
}
