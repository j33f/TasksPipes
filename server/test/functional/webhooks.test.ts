import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { config } from "../../src/config.js";
import { pool } from "../../src/db.js";
import { RETRY_DELAYS_MS, runWebhooks, signature } from "../../src/webhooks.js";

interface Received { headers: http.IncomingHttpHeaders; body: string; json: any }
let alice: Agent, bob: Agent, carol: Agent, bobId: string;
let server: http.Server, url: string, received: Received[], answer = 200;

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  carol = await signIn("carol-token");
  bobId = (await bob.get("/api/me")).body.user.id;
  // A receiver on localhost (WEBHOOK_ALLOW_PRIVATE is on in the tests).
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body, json: JSON.parse(body) });
      res.writeHead(answer).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});
beforeEach(async () => {
  received = [];
  answer = 200;
  // Earlier tests' deliveries are not this test's business.
  await pool.query(`UPDATE webhook_deliveries SET failed_at = now() WHERE delivered_at IS NULL AND failed_at IS NULL`);
});
afterAll(async () => {
  server.close();
  await stopApp();
});

const team = async (name: string) => {
  const id = (await alice.post("/api/spaces", { name, members: [{ userId: bobId }] })).body.id;
  return { id, pipe: (await alice.post(`/api/spaces/${id}/pipes`, { name: "Board" })).body.id as string };
};
const hook = async (pipe: string, events: string[]) => (await alice.post(`/api/pipes/${pipe}/webhooks`, { url, events })).body;

describe("outgoing webhooks", () => {
  it("send the chosen events, signed, with the task and the change", async () => {
    const { pipe } = await team("Hooked");
    const h = await hook(pipe, ["task.created", "task.moved", "task.commented", "task.done", "task.assigned"]);
    expect(h.secret).toMatch(/^[0-9a-f]{64}$/);
    const id = (await alice.post("/api/tasks", { title: "Hooked task", pipeId: pipe })).body.id;
    await alice.patch(`/api/tasks/${id}`, { stage: "ongoing", assigneeId: bobId });
    await alice.post(`/api/tasks/${id}/comments`, { body: "Looks fine" });
    await alice.patch(`/api/tasks/${id}`, { stage: "done" });
    expect(await runWebhooks()).toBe(6);

    expect(received.map((r) => r.json.event)).toEqual(["task.created", "task.moved", "task.assigned", "task.commented", "task.moved", "task.done"]);
    const moved = received[1];
    expect(moved.json).toMatchObject({
      pipe: { id: pipe, name: "Board" },
      task: { id, title: "Hooked task", key: expect.stringMatching(/^TP-\d+$/) },
      actor: { name: "Alice Martin" },
      change: { from: { status: "backlog" }, to: { status: "ongoing" } },
    });
    expect(received[3].json.comment).toBe("Looks fine");
    // The signature: HMAC-SHA256 of "timestamp.body" with the webhook's secret.
    const ts = Number(moved.headers["x-taskspipes-timestamp"]);
    expect(moved.headers["x-taskspipes-signature"]).toBe(signature(h.secret, ts, moved.body));
    expect(moved.headers["x-taskspipes-event"]).toBe("task.moved");
    expect(moved.json.id).toBe(moved.headers["x-taskspipes-delivery"]);
    // Sent once.
    expect(await runWebhooks()).toBe(0);
    const listed = (await alice.get(`/api/pipes/${pipe}/webhooks`)).body[0];
    expect(listed.deliveries[0]).toMatchObject({ state: "delivered", status: 200 });
  });

  it("are retried with growing delays, then given up", async () => {
    const { pipe } = await team("Failing");
    await hook(pipe, ["task.created"]);
    answer = 500;
    await alice.post("/api/tasks", { title: "Will fail", pipeId: pipe });
    let now = new Date();
    expect(await runWebhooks(now)).toBe(0);
    for (const delay of RETRY_DELAYS_MS) {
      // Nothing before the delay, an attempt after it.
      expect(await runWebhooks(new Date(now.getTime() + delay - 1000))).toBe(0);
      const before = received.length;
      now = new Date(now.getTime() + delay + 1000);
      await runWebhooks(now);
      expect(received.length).toBe(before + 1);
    }
    const listed = (await alice.get(`/api/pipes/${pipe}/webhooks`)).body[0];
    expect(listed.deliveries[0]).toMatchObject({ state: "failed", status: 500, error: "HTTP 500", attempts: RETRY_DELAYS_MS.length + 1 });
  });

  it("send nothing when turned off, and a ping on request", async () => {
    const { pipe } = await team("Paused");
    const h = await hook(pipe, ["task.created"]);
    await alice.patch(`/api/webhooks/${h.id}`, { active: false });
    await alice.post("/api/tasks", { title: "Quiet", pipeId: pipe });
    expect(await runWebhooks()).toBe(0);
    await alice.patch(`/api/webhooks/${h.id}`, { active: true, events: ["task.done"] });
    await alice.post(`/api/webhooks/${h.id}/ping`);
    await runWebhooks();
    // Nothing was queued while it was off; the ping goes.
    expect(received.map((r) => r.json.event)).toEqual(["ping"]);
  });

  it("do not exist on confidential pipes, whose tasks never leave", async () => {
    const t = await team("Confidential hooks");
    const psh = (await alice.post(`/api/spaces/${t.id}/pipes`, { name: "PSH", kind: "psh" })).body.id;
    const refused = await alice.post(`/api/pipes/${psh}/webhooks`, { url, events: ["task.created"] });
    expect(refused.body.error).toBe("A confidential pipe has no webhooks: its content stays in the app.");
    // A hook of the team's ordinary pipe hears nothing of the confidential one.
    await hook(t.pipe, ["task.created", "task.moved"]);
    await alice.post("/api/tasks", { title: "Ms L.", pipeId: psh, taskType: "accompagnement_psh" });
    await alice.post("/api/tasks", { title: "Ordinary", pipeId: t.pipe });
    await runWebhooks();
    expect(received.map((r) => r.json.task.title)).toEqual(["Ordinary"]);
  });

  it("are managed by the space's members only", async () => {
    const { pipe } = await team("Members only");
    expect((await carol.post(`/api/pipes/${pipe}/webhooks`, { url, events: ["task.created"] })).status).toBe(404);
    expect((await carol.get(`/api/pipes/${pipe}/webhooks`)).status).toBe(404);
    const h = await hook(pipe, ["task.created"]);
    expect((await carol.del(`/api/webhooks/${h.id}`)).status).toBe(404);
    expect((await bob.get(`/api/pipes/${pipe}/webhooks`)).body[0].id).toBe(h.id);
  });

  it("only go to public https addresses, unless WEBHOOK_ALLOW_PRIVATE", async () => {
    const { pipe } = await team("Addresses");
    expect((await alice.post(`/api/pipes/${pipe}/webhooks`, { url: "nope", events: ["task.created"] })).body.error).toBe("Invalid address");
    expect((await alice.post(`/api/pipes/${pipe}/webhooks`, { url, events: [] })).body.error).toBe("Choose at least one event");
    config.webhookAllowPrivate = false;
    try {
      expect((await alice.post(`/api/pipes/${pipe}/webhooks`, { url, events: ["task.created"] })).body.error).toBe("A webhook address must use https://");
      expect((await alice.post(`/api/pipes/${pipe}/webhooks`, { url: "https://127.0.0.1/hook", events: ["task.created"] })).body.error)
        .toBe("This address is not allowed (internal address).");
      expect((await alice.post(`/api/pipes/${pipe}/webhooks`, { url: "https://user:pw@example.com/", events: ["task.created"] })).body.error).toBe("Invalid address");
    } finally {
      config.webhookAllowPrivate = true;
    }
  });
});
