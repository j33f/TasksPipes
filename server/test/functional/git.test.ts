import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";

let app: FastifyInstance, alice: Agent, carol: Agent, pipe: string, other: string;

beforeAll(async () => {
  app = await startApp();
  alice = await signIn("alice-token");
  carol = await signIn("carol-token");
  const space = (await alice.get("/api/me")).body.personalSpaceId;
  pipe = (await alice.post(`/api/spaces/${space}/pipes`, { name: "App", kind: "dev" })).body.id;
  other = (await alice.post(`/api/spaces/${space}/pipes`, { name: "Other", kind: "dev" })).body.id;
});
afterAll(stopApp);

/** Sends a webhook the way GitHub or GitLab would. */
async function hook(url: string, event: string, payload: unknown, sign: { github?: string; gitlab?: string }) {
  const body = JSON.stringify(payload);
  const path = new URL(url).pathname;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sign.github !== undefined) {
    headers["x-github-event"] = event;
    headers["x-hub-signature-256"] = `sha256=${crypto.createHmac("sha256", sign.github).update(body).digest("hex")}`;
  }
  if (sign.gitlab !== undefined) {
    headers["x-gitlab-event"] = event;
    headers["x-gitlab-token"] = sign.gitlab;
  }
  const res = await app.inject({ method: "POST", url: path, headers, payload: body });
  return { status: res.statusCode, body: res.json() };
}

const pr = (n: number, action: string, extra: Record<string, unknown> = {}) => ({
  action,
  repository: { full_name: "acme/app" },
  pull_request: { number: 7, html_url: "https://github.com/acme/app/pull/7", title: `Login TP-${n}`, body: "", head: { ref: `tp-${n}-login` }, user: { login: "ana" }, state: "open", draft: false, merged: false, ...extra },
});

describe("GitHub integration", () => {
  let gh: { url: string; secret: string }, task: { id: string; number: number }, elsewhere: { id: string; number: number };

  it("is set up by members of the pipe's space only", async () => {
    gh = (await alice.post(`/api/pipes/${pipe}/integrations`, { provider: "github" })).body;
    expect(gh.url).toMatch(/^http:\/\/tasks\.test\/hooks\/github\/[\w-]+$/);
    expect(gh.secret.length).toBeGreaterThan(20);
    expect((await alice.get(`/api/pipes/${pipe}/integrations`)).body).toHaveLength(1);
    expect((await carol.get(`/api/pipes/${pipe}/integrations`)).status).toBe(404);
    expect((await alice.post(`/api/pipes/${pipe}/integrations`, { provider: "bitbucket" })).status).toBe(400);
  });

  it("refuses unsigned or wrongly signed webhooks", async () => {
    expect((await hook(gh.url, "ping", {}, { github: "wrong" })).status).toBe(401);
    expect((await hook(gh.url.replace(/[\w-]+$/, "nope"), "ping", {}, { github: gh.secret })).status).toBe(404);
    expect((await hook(gh.url, "ping", { zen: "hi" }, { github: gh.secret })).status).toBe(200);
  });

  it("links a pull request and moves the task to review, then done when merged", async () => {
    const id = (await alice.post("/api/tasks", { title: "Login page", pipeId: pipe, taskType: "user_story" })).body.id;
    task = (await alice.get(`/api/tasks/${id}`)).body;
    expect((task as { key?: string } & typeof task).key).toBe(`TP-${task.number}`);

    const opened = await hook(gh.url, "pull_request", pr(task.number, "opened"), { github: gh.secret });
    expect(opened.body).toMatchObject({ linked: 1, moved: 1 });
    let detail = (await alice.get(`/api/tasks/${id}`)).body;
    expect(detail).toMatchObject({ stage: "revue", status: "ongoing", gitState: "open", gitConnected: true });
    expect(detail.links[0]).toMatchObject({ kind: "pull_request", number: 7, state: "open", repo: "acme/app" });
    expect(detail.events.slice(-2).map((e: { type: string; actor: { name: string } }) => `${e.type}:${e.actor.name}`)).toEqual(["linked:GitHub", "status:GitHub"]);

    const merged = await hook(gh.url, "pull_request", pr(task.number, "closed", { state: "closed", merged: true }), { github: gh.secret });
    expect(merged.body).toMatchObject({ linked: 0, moved: 1 });
    detail = (await alice.get(`/api/tasks/${id}`)).body;
    expect(detail).toMatchObject({ stage: "termine", status: "done", gitState: "merged" });
    expect(detail.links).toHaveLength(1);
  });

  it("only touches tasks of the connected pipe", async () => {
    const id = (await alice.post("/api/tasks", { title: "Elsewhere", pipeId: other })).body.id;
    elsewhere = (await alice.get(`/api/tasks/${id}`)).body;
    const res = await hook(gh.url, "pull_request", pr(elsewhere.number, "opened"), { github: gh.secret });
    expect(res.body).toMatchObject({ linked: 0, moved: 0 });
    expect((await alice.get(`/api/tasks/${id}`)).body.stage).toBe("backlog");
  });

  it("links pushed commits without moving the task", async () => {
    const id = (await alice.post("/api/tasks", { title: "Refactor", pipeId: pipe })).body.id;
    const n = (await alice.get(`/api/tasks/${id}`)).body.number;
    const push = { ref: "refs/heads/main", repository: { full_name: "acme/app" }, commits: [{ message: `TP-${n}: split module`, url: "https://github.com/acme/app/commit/abc123", author: { username: "ana" } }] };
    expect((await hook(gh.url, "push", push, { github: gh.secret })).body).toMatchObject({ linked: 1, moved: 0 });
    const detail = (await alice.get(`/api/tasks/${id}`)).body;
    expect(detail.links[0]).toMatchObject({ kind: "commit", title: `TP-${n}: split module` });
    expect(detail.stage).toBe("backlog");
  });

  it("stops when disconnected", async () => {
    expect((await alice.del(`/api/pipes/${pipe}/integrations/github`)).status).toBe(200);
    expect((await hook(gh.url, "ping", {}, { github: gh.secret })).status).toBe(404);
  });
});

describe("GitLab integration", () => {
  it("moves a task to done when its merge request is merged", async () => {
    const gl = (await alice.post(`/api/pipes/${pipe}/integrations`, { provider: "gitlab" })).body;
    const id = (await alice.post("/api/tasks", { title: "Export", pipeId: pipe })).body.id;
    const n = (await alice.get(`/api/tasks/${id}`)).body.number;
    const mr = (action: string, state: string) => ({
      project: { path_with_namespace: "acme/app" }, user: { username: "ana" },
      object_attributes: { iid: 3, url: "https://gitlab.com/acme/app/-/merge_requests/3", title: `TP-${n} export`, source_branch: "x", description: "", state, draft: true, action },
    });
    expect((await hook(gl.url, "Merge Request Hook", mr("open", "opened"), { gitlab: "wrong" })).status).toBe(401);
    await hook(gl.url, "Merge Request Hook", mr("open", "opened"), { gitlab: gl.secret });
    expect((await alice.get(`/api/tasks/${id}`)).body).toMatchObject({ stage: "en_cours", gitState: "draft" });
    await hook(gl.url, "Merge Request Hook", mr("merge", "merged"), { gitlab: gl.secret });
    expect((await alice.get(`/api/tasks/${id}`)).body).toMatchObject({ stage: "termine", gitState: "merged" });
  });
});
