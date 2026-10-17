import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { gitItems, taskKeys, verifyGithub, verifyGitlab } from "./git.js";

describe("taskKeys", () => {
  it("finds task keys in branches, titles and messages, any case", () => {
    expect(taskKeys("feature/TP-12-login", "Fix TP-3 and tp-12", null)).toEqual([12, 3]);
    expect(taskKeys("tp-7")).toEqual([7]);
  });

  it("ignores look-alikes", () => {
    expect(taskKeys("STP-4", "TP-", "TP-x", "HTTP-500", "TP-12345678901")).toEqual([]);
  });
});

describe("signatures", () => {
  const body = Buffer.from('{"a":1}');
  const sign = (secret: string) => `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

  it("check GitHub's HMAC", () => {
    expect(verifyGithub("s3cret", body, sign("s3cret"))).toBe(true);
    expect(verifyGithub("s3cret", body, sign("other"))).toBe(false);
    expect(verifyGithub("s3cret", body, undefined)).toBe(false);
    expect(verifyGithub("s3cret", body, "sha1=abc")).toBe(false);
  });

  it("check GitLab's token", () => {
    expect(verifyGitlab("s3cret", "s3cret")).toBe(true);
    expect(verifyGitlab("s3cret", "s3cre")).toBe(false);
    expect(verifyGitlab("s3cret", undefined)).toBe(false);
  });
});

const ghPr = (action: string, pr: Record<string, unknown>) => ({
  action,
  repository: { full_name: "acme/app" },
  pull_request: { number: 5, html_url: "https://github.com/acme/app/pull/5", title: "Login TP-9", body: "", head: { ref: "tp-9-login" }, user: { login: "ana" }, state: "open", draft: false, merged: false, ...pr },
});

describe("GitHub events", () => {
  it("move a task along its pull request", () => {
    expect(gitItems("github", "pull_request", ghPr("opened", {}))[0]).toMatchObject({ keys: [9], move: "ongoing", action: "opened", link: { kind: "pull_request", state: "open", number: 5, repo: "acme/app", author: "ana" } });
    expect(gitItems("github", "pull_request", ghPr("opened", { draft: true }))[0]).toMatchObject({ move: "started", link: { state: "draft" } });
    expect(gitItems("github", "pull_request", ghPr("ready_for_review", {}))[0].move).toBe("ongoing");
    expect(gitItems("github", "pull_request", ghPr("closed", { state: "closed", merged: true }))[0]).toMatchObject({ move: "done", action: "merged", link: { state: "merged" } });
    expect(gitItems("github", "pull_request", ghPr("closed", { state: "closed" }))[0]).toMatchObject({ move: null, action: "closed", link: { state: "closed" } });
    expect(gitItems("github", "pull_request", ghPr("synchronize", {}))[0].move).toBeNull();
  });

  it("link pushed commits without moving tasks, and ignore other events", () => {
    const push = { ref: "refs/heads/main", repository: { full_name: "acme/app" }, commits: [{ message: "TP-9 fix\n\nbody", url: "https://github.com/acme/app/commit/abc", author: { username: "ana" } }, { message: "no key", url: "https://x/y" }] };
    const items = gitItems("github", "push", push);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ keys: [9], move: null, link: { kind: "commit", title: "TP-9 fix", state: "pushed" } });
    expect(gitItems("github", "issues", { action: "opened" })).toEqual([]);
  });
});

describe("GitLab events", () => {
  const mr = (action: string, attrs: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
    project: { path_with_namespace: "acme/app" }, user: { username: "ana" },
    object_attributes: { iid: 3, url: "https://gitlab.com/acme/app/-/merge_requests/3", title: "TP-4 export", source_branch: "x", description: "", state: "opened", draft: false, action, ...attrs },
    ...extra,
  });

  it("move a task along its merge request", () => {
    expect(gitItems("gitlab", "Merge Request Hook", mr("open"))[0]).toMatchObject({ keys: [4], move: "ongoing", link: { kind: "merge_request", number: 3 } });
    expect(gitItems("gitlab", "Merge Request Hook", mr("open", { draft: true }))[0].move).toBe("started");
    expect(gitItems("gitlab", "Merge Request Hook", mr("merge", { state: "merged" }))[0]).toMatchObject({ move: "done", action: "merged" });
    expect(gitItems("gitlab", "Merge Request Hook", mr("update", {}, { changes: { draft: { previous: true, current: false } } }))[0].move).toBe("ongoing");
    expect(gitItems("gitlab", "Merge Request Hook", mr("update"))[0].move).toBeNull();
  });

  it("link pushed commits", () => {
    const push = { ref: "refs/heads/tp-4-export", project: { path_with_namespace: "acme/app" }, commits: [{ message: "wip", url: "https://gitlab.com/c/1", author: { name: "Ana" } }] };
    expect(gitItems("gitlab", "Push Hook", push)[0]).toMatchObject({ keys: [4], link: { author: "Ana" } });
  });
});
