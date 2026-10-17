/**
 * GitHub and GitLab integration: webhooks link pull/merge requests and commits to tasks, and move the tasks
 * along, like Jira does.
 *
 * A task is named by its key, "TP-<number>" (case-insensitive), in a branch name, a PR/MR title or description,
 * or a commit message. A pipe connected to a repository receives its webhooks at /hooks/<provider>/<token>:
 * GitHub signs them (X-Hub-Signature-256), GitLab sends the secret (X-Gitlab-Token).
 *
 * Moves: a draft PR/MR → the first "started" column; an open or ready one → the first "ongoing" column
 * (In review); merged → the first "done" column. Commits are linked without moving the task.
 */
import crypto from "node:crypto";
import type { Status } from "./pipeTypes.js";

export type Provider = "github" | "gitlab";
export const PROVIDERS: Provider[] = ["github", "gitlab"];

/** Prefix of task keys: TP-123 is the task number 123. */
export const TASK_KEY_PREFIX = "TP";

/** Task numbers named in some texts (TP-12, tp-12, feature/TP-12-login…). */
export function taskKeys(...texts: (string | null | undefined)[]): number[] {
  const found = new Set<number>();
  for (const t of texts) {
    for (const m of (t ?? "").matchAll(new RegExp(`(?:^|[^a-z0-9])${TASK_KEY_PREFIX}-(\\d{1,9})(?![0-9])`, "gi"))) found.add(Number(m[1]));
  }
  return [...found];
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** GitHub: HMAC-SHA256 of the raw body with the secret, in X-Hub-Signature-256. */
export function verifyGithub(secret: string, body: Buffer, signature: string | undefined): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  return safeEqual(expected, signature);
}

/** GitLab: the secret itself, in X-Gitlab-Token. */
export const verifyGitlab = (secret: string, token: string | undefined) => Boolean(token) && safeEqual(secret, token!);

export type LinkState = "draft" | "open" | "merged" | "closed" | "pushed";

/** Something to link to the tasks it names, and where to move them. */
export interface GitItem {
  keys: number[];
  link: {
    kind: "pull_request" | "merge_request" | "commit";
    url: string;
    number: number | null;
    title: string;
    state: LinkState;
    repo: string;
    author: string | null;
  };
  /** Generic state of the column to move the tasks to. */
  move: Status | null;
  /** What happened, for the history ("merged", "opened"…). */
  action: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: any) => (typeof v === "string" ? v : "");
const firstLine = (s: string) => s.split("\n")[0].slice(0, 300);

function githubPr(payload: any): GitItem[] {
  const pr = payload.pull_request;
  if (!pr) return [];
  const merged = Boolean(pr.merged);
  const state: LinkState = merged ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open";
  const action = str(payload.action);
  let move: Status | null = null;
  if (action === "closed" && merged) move = "done";
  else if (["opened", "reopened"].includes(action)) move = pr.draft ? "started" : "ongoing";
  else if (action === "ready_for_review") move = "ongoing";
  else if (action === "converted_to_draft") move = "started";
  return [{
    keys: taskKeys(str(pr.head?.ref), str(pr.title), str(pr.body)),
    link: {
      kind: "pull_request", url: str(pr.html_url), number: Number(pr.number) || null, title: firstLine(str(pr.title)), state,
      repo: str(payload.repository?.full_name), author: str(pr.user?.login) || null,
    },
    move,
    action: action === "closed" ? (merged ? "merged" : "closed") : action,
  }];
}

function gitlabMr(payload: any): GitItem[] {
  const mr = payload.object_attributes;
  if (!mr) return [];
  const draft = Boolean(mr.draft ?? mr.work_in_progress);
  const state: LinkState = mr.state === "merged" ? "merged" : mr.state === "closed" ? "closed" : draft ? "draft" : "open";
  const action = str(mr.action);
  let move: Status | null = null;
  if (action === "merge") move = "done";
  else if (["open", "reopen"].includes(action)) move = draft ? "started" : "ongoing";
  // A draft marked ready (or the reverse) arrives as an update that changes the draft flag.
  else if (action === "update" && payload.changes?.draft) move = draft ? "started" : "ongoing";
  return [{
    keys: taskKeys(str(mr.source_branch), str(mr.title), str(mr.description)),
    link: {
      kind: "merge_request", url: str(mr.url), number: Number(mr.iid) || null, title: firstLine(str(mr.title)), state,
      repo: str(payload.project?.path_with_namespace), author: str(payload.user?.username) || null,
    },
    move,
    action: { open: "opened", reopen: "reopened", merge: "merged", close: "closed" }[action] ?? action,
  }];
}

/** Commits of a push (both providers): linked to the tasks their message or branch names. */
function pushCommits(provider: Provider, payload: any): GitItem[] {
  const branch = str(payload.ref).replace(/^refs\/heads\//, "");
  const repo = provider === "github" ? str(payload.repository?.full_name) : str(payload.project?.path_with_namespace);
  const commits: any[] = Array.isArray(payload.commits) ? payload.commits.slice(0, 50) : [];
  return commits.map((c) => ({
    keys: taskKeys(str(c.message), branch),
    link: {
      kind: "commit" as const, url: str(c.url), number: null, title: firstLine(str(c.message)), state: "pushed" as const,
      repo, author: str(c.author?.username) || str(c.author?.name) || null,
    },
    move: null,
    action: "pushed",
  }));
}

/** What a webhook event means for tasks; events of no interest give nothing. */
export function gitItems(provider: Provider, event: string | undefined, payload: any): GitItem[] {
  const items =
    provider === "github"
      ? event === "pull_request" ? githubPr(payload) : event === "push" ? pushCommits("github", payload) : []
      : event === "Merge Request Hook" ? gitlabMr(payload) : event === "Push Hook" ? pushCommits("gitlab", payload) : [];
  return items.filter((i) => i.keys.length && /^https?:\/\//.test(i.link.url));
}
