/** Administration › AI assistant: connecting an AI, listing its models and checking it, against a fake AI server. */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { loadSettings, pool } from "../../src/db.js";

let alice: Agent, bob: Agent;
let server: http.Server, url = "";
const seen: { path: string; headers: http.IncomingHttpHeaders; body: any }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : null });
      res.setHeader("content-type", "application/json");
      if (req.headers.authorization !== "Bearer good-key" && req.headers["x-api-key"] !== "good-key") {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: { message: "invalid key bad-key" } }));
      }
      if (req.url?.startsWith("/v1/models")) return res.end(JSON.stringify({ data: [{ id: "zeta" }, { id: "alpha", display_name: "Alpha" }] }));
      if (req.url === "/v1/chat/completions") return res.end(JSON.stringify({ choices: [{ message: { content: " Hello! " } }] }));
      if (req.url === "/v1/messages") return res.end(JSON.stringify({ content: [{ type: "text", text: "Hi there." }] }));
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
});
afterAll(async () => {
  await pool.query(`DELETE FROM instance_settings WHERE key LIKE 'ai.%'`);
  await loadSettings();
  await stopApp();
  server.close();
});

const other = { "ai.provider": "other", "ai.api": "openai", "ai.apiKey": "good-key", "ai.allowPrivate": true };

describe("AI assistant settings", () => {
  it("are for administrators only, and off at first", async () => {
    expect((await bob.post("/api/admin/ai/models", { settings: {} })).status).toBe(404);
    expect((await bob.get("/api/me")).body.features.ai).toBe(false);
    expect((await alice.post("/api/admin/ai/models", { settings: {} })).body.error).toBe("Choose an AI provider first");
  });

  it("refuse an unknown provider or effort", async () => {
    expect((await alice.put("/api/admin/settings", { settings: { "ai.provider": "skynet" } })).body.error).toBe("Invalid value for ai.provider");
    expect((await alice.put("/api/admin/settings", { settings: { "ai.effort": "extreme" } })).body.error).toBe("Invalid value for ai.effort");
  });

  it("refuse an internal address unless allowed", async () => {
    const res = await alice.post("/api/admin/ai/models", { settings: { ...other, "ai.url": url, "ai.allowPrivate": false } });
    expect(res.body.error).toBe("This AI is on an internal address: allow internal addresses first");
  });

  it("list the models of the values being edited, before saving", async () => {
    const res = await alice.post("/api/admin/ai/models", { settings: { ...other, "ai.url": url } });
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([{ id: "alpha", name: "Alpha" }, { id: "zeta", name: "zeta" }]);
    expect(seen.at(-1)!.headers.authorization).toBe("Bearer good-key");
  });

  it("tell the provider's error, without the key", async () => {
    const res = await alice.post("/api/admin/ai/models", { settings: { ...other, "ai.url": url, "ai.apiKey": "bad-key" } });
    expect(res.body.error).toMatch(/^The AI answered 401: /);
    expect(res.body.error).not.toContain("bad-key");
  });

  it("check the saved connection with the saved key", async () => {
    const saved = await alice.put("/api/admin/settings", { settings: { ...other, "ai.url": url, "ai.model": "alpha", "ai.effort": "low" } });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.find((s: { key: string }) => s.key === "ai.apiKey")).toMatchObject({ value: null, isSet: true });
    // An empty key: the saved one.
    const res = await alice.post("/api/admin/ai/test", { settings: { "ai.apiKey": "" } });
    expect(res.body).toEqual({ ok: true, model: "alpha", answer: "Hello!" });
    expect(seen.at(-1)!.body).toMatchObject({ model: "alpha", reasoning_effort: "low" });
    expect((await bob.get("/api/me")).body.features.ai).toBe(true);
  });

  it("speak the Anthropic API too", async () => {
    const res = await alice.post("/api/admin/ai/test", { settings: { "ai.api": "anthropic" } });
    expect(res.body.answer).toBe("Hi there.");
    const last = seen.at(-1)!;
    expect(last.path).toBe("/v1/messages");
    expect(last.headers["x-api-key"]).toBe("good-key");
    expect(last.body).toMatchObject({ model: "alpha", system: expect.any(String), output_config: { effort: "low" } });
  });
});
