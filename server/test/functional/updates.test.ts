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
