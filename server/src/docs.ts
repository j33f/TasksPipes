/**
 * The documentation of TasksPipes, for AI agents over MCP (mcp.ts: docs_contents, read_docs): the Markdown guides
 * shipped with the app (docs/, copied into the image), so that what an agent reads matches the version running, with
 * no request to another site. Split into sections (## headings), read once.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The guides an agent may read: what the app does, for people. Hosting guides are for administrators, not here. */
const GUIDES = [
  { doc: "features", file: "FEATURES.md", about: "Everything TasksPipes does: spaces, pipes, tasks, incoming buckets, notifications, reports, access rules…" },
  { doc: "agents", file: "MCP.md", about: "AI agents over MCP: what they may do, how they are connected, the tools" },
  { doc: "models", file: "MODELS.md", about: "Models: pipe and task types shared as YAML files" },
] as const;

export interface DocSection {
  doc: string;
  title: string;
  text: string;
}

/** At most this much text in one answer: a few sections, not the whole guide. */
const MAX_TEXT = 15_000;

function docsDir(): string | null {
  const candidates = [process.env.DOCS_DIR, "../docs", "../../docs"].filter(Boolean) as string[];
  for (const c of candidates) {
    const dir = c.startsWith("/") ? c : fileURLToPath(new URL(`${c}/`, import.meta.url));
    if (existsSync(`${dir}/FEATURES.md`)) return dir;
  }
  return null;
}

let sections: DocSection[] | null = null;

/** The sections of every guide; empty when the guides are not there (a build without them). */
export function docSections(): DocSection[] {
  if (sections) return sections;
  const dir = docsDir();
  const found: DocSection[] = [];
  if (dir) {
    for (const g of GUIDES) {
      if (!existsSync(`${dir}/${g.file}`)) continue;
      const md = readFileSync(`${dir}/${g.file}`, "utf8");
      const parts = md.split(/^## /m);
      // What comes before the first section: the guide's own introduction.
      const intro = parts[0].replace(/^# .*\n/, "").trim();
      if (intro) found.push({ doc: g.doc, title: "Introduction", text: intro });
      for (const p of parts.slice(1)) {
        const nl = p.indexOf("\n");
        const title = (nl < 0 ? p : p.slice(0, nl)).trim();
        const text = (nl < 0 ? "" : p.slice(nl + 1)).trim();
        if (title) found.push({ doc: g.doc, title, text: `## ${title}\n\n${text}` });
      }
    }
  }
  sections = found;
  return found;
}

/** The table of contents: each guide, what it is about, and the titles of its sections. */
export function docsContents() {
  const all = docSections();
  return GUIDES.filter((g) => all.some((s) => s.doc === g.doc)).map((g) => ({
    doc: g.doc,
    about: g.about,
    sections: all.filter((s) => s.doc === g.doc && s.title !== "Introduction").map((s) => s.title),
  }));
}

const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{3,}/g) ?? [];

/**
 * The sections a topic names: the one with that title (any case), else those whose words match best (the title
 * counting more), up to a few, within MAX_TEXT. `doc` narrows to one guide.
 */
export function readDocs(topic: string, doc?: string): DocSection[] {
  const pool = docSections().filter((s) => !doc || s.doc === doc);
  const wanted = topic.trim().toLowerCase();
  const exact = pool.filter((s) => s.title.toLowerCase() === wanted);
  if (exact.length) return exact;
  const asked = [...new Set(words(topic))];
  if (!asked.length) return [];
  const scored = pool
    .map((s) => {
      const title = words(s.title);
      const body = words(s.text);
      const score = asked.reduce((n, w) => n + 5 * title.filter((x) => x.startsWith(w)).length + body.filter((x) => x.startsWith(w)).length, 0);
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const out: DocSection[] = [];
  let size = 0;
  for (const { s } of scored) {
    if (out.length && size + s.text.length > MAX_TEXT) break;
    out.push(s.text.length > MAX_TEXT ? { ...s, text: `${s.text.slice(0, MAX_TEXT)}\n…` } : s);
    size += s.text.length;
  }
  return out;
}
