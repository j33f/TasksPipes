import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { checkForUpdate, updateState, type Release } from "../../src/updates.js";
import { config } from "../../src/config.js";

let alice: Agent, bob: Agent;
const sent: { to: string; subject: string }[] = [];
const send = async (_lang: string, to: string, subject: string) => void sent.push({ to, subject });
const release = (version: string): Release => ({ version, url: `https://github.com/j33f/TasksPipes/releases/tag/v${version}`, publishedAt: null });
let published: Release | null = null;
const realFetch = updateState.fetch;

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token"); // an administrator (ADMIN_EMAILS)
  bob = await signIn("bob-token");
  updateState.fetch = async () => published;
});
afterAll(async () => {
  updateState.fetch = realFetch;
  updateState.latest = null;
  await stopApp();
});

describe("New versions", () => {
  it("are not announced while the one running is the latest", async () => {
    published = release(config.version);
    expect(await checkForUpdate(send)).toBeNull();
    expect(sent).toEqual([]);
    expect((await bob.get("/api/version")).body).toMatchObject({ current: config.version, updateAvailable: false });
  });

  it("are told to the administrators once, and shown to everyone", async () => {
    published = release("99.0.0");
    expect(await checkForUpdate(send)).toBe("99.0.0");
    // Every administrator (other test files made some), each once; Bob is not one.
    expect(sent).toContainEqual({ to: "alice@example.com", subject: "TasksPipes 99.0.0 is available" });
    expect(sent.some((m) => m.to === "bob@example.com")).toBe(false);
    expect(new Set(sent.map((m) => m.to)).size).toBe(sent.length);
    // Checked again (or by another instance): not told twice.
    const before = sent.length;
    expect(await checkForUpdate(send)).toBeNull();
    expect(sent).toHaveLength(before);
    const v = (await bob.get("/api/version")).body;
    expect(v).toMatchObject({ current: config.version, updateAvailable: true, latest: { version: "99.0.0", url: release("99.0.0").url } });
  });

  it("are no longer checked once an administrator turns it off", async () => {
    expect((await alice.put("/api/admin/settings", { settings: { "updates.check": false } })).status).toBe(200);
    published = release("99.1.0");
    expect(await checkForUpdate(send)).toBeNull();
    expect((await bob.get("/api/version")).body).toMatchObject({ updateAvailable: false, latest: null });
    await alice.put("/api/admin/settings", { settings: { "updates.check": true } });
  });

  it("need a signed-in person to be read", async () => {
    const res = await (await import("./helpers.js")).agent().get("/api/version");
    expect(res.status).toBe(401);
  });
});

describe("One-click updates", () => {
  const TOKEN = "functional-updater-token-0123456789";
  let server: Server;
  const received: { method: string; url: string; auth: string; body: string }[] = [];
  let answer = { status: 202, body: { state: "running" } as object };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ method: req.method!, url: req.url!, auth: req.headers.authorization ?? "", body });
        const r = req.method === "GET" ? { status: 200, body: { state: "running", version: "99.0.0", from: "latest", log: ["2026-10-30T15:00:00Z Updating from latest to 99.0.0."] } } : answer;
        res.writeHead(r.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(r.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    config.updaterUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    config.updaterToken = TOKEN;
    published = release("99.0.0");
    await checkForUpdate(send);
  });
  afterAll(() => {
    config.updaterUrl = "";
    config.updaterToken = "";
    server.close();
  });

  it("are offered to administrators only", async () => {
    expect((await alice.get("/api/version")).body.canUpdate).toBe(true);
    expect((await bob.get("/api/version")).body.canUpdate).toBe(false);
    expect((await bob.post("/api/admin/update", { version: "99.0.0" })).status).toBe(403);
    expect((await bob.get("/api/admin/update")).status).toBe(403);
  });

  it("install the latest published version only", async () => {
    for (const version of ["98.0.0", "latest", config.version, undefined]) {
      const res = await alice.post("/api/admin/update", { version });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Only the latest published version can be installed.");
    }
    expect(received).toEqual([]);
  });

  it("ask the updater, with its token, and follow it", async () => {
    expect((await alice.post("/api/admin/update", { version: "99.0.0" })).status).toBe(200);
    expect(received.at(-1)).toEqual({ method: "POST", url: "/update", auth: `Bearer ${TOKEN}`, body: '{"version":"99.0.0"}' });
    const s = await alice.get("/api/admin/update");
    expect(s.body).toMatchObject({ current: config.version, state: "running", version: "99.0.0", log: [expect.stringContaining("Updating")] });
  });

  it("tell what goes wrong with the updater", async () => {
    answer = { status: 409, body: { error: "busy" } };
    expect((await alice.post("/api/admin/update", { version: "99.0.0" })).body.error).toBe("An update is already running.");
    answer = { status: 401, body: {} };
    expect((await alice.post("/api/admin/update", { version: "99.0.0" })).status).toBe(502);
    config.updaterUrl = "http://127.0.0.1:1";
    const res = await alice.post("/api/admin/update", { version: "99.0.0" });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("The updater cannot be reached.");
  });
});
