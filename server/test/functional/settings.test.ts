import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, signInWithLink, startApp, stopApp, type Agent } from "./helpers.js";
import { config } from "../../src/config.js";
import { loadSettings, pool } from "../../src/db.js";
import { mailEnabled } from "../../src/mail.js";

let alice: Agent, bob: Agent, mailAdmin: Agent;

const put = (a: Agent, settings: Record<string, unknown>) => a.put("/api/admin/settings", { settings });
const find = (list: { key: string }[], key: string) => list.find((s) => s.key === key) as Record<string, unknown>;

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  mailAdmin = await signInWithLink((await bob.post("/api/invitations", { email: "settings-admin@example.com", name: "Settings admin" })).body.link);
});
afterAll(async () => {
  // The other test files find the instance as the environment sets it.
  await pool.query(`DELETE FROM instance_settings`);
  await loadSettings();
  await stopApp();
});

describe("instance settings", () => {
  it("are for administrators only", async () => {
    for (const res of [await bob.get("/api/admin/settings"), await put(bob, { "smtp.host": "x" }), await bob.post("/api/admin/settings/test-mail")]) {
      expect(res.status).toBe(404);
    }
  });

  it("show each setting, locked when the environment sets it", async () => {
    const { settings, oauthRedirect } = (await alice.get("/api/admin/settings")).body;
    expect(find(settings, "outline.url")).toMatchObject({ locked: true, env: "OUTLINE_URL" });
    expect(find(settings, "smtp.host")).toMatchObject({ locked: false, value: "" });
    expect(oauthRedirect).toBe("http://tasks.test/auth/outline/callback");
    expect((await put(alice, { "outline.url": "https://elsewhere.test" })).body.error).toBe("outline.url is set by the server (OUTLINE_URL): change it there");
  });

  it("apply at once, secrets kept encrypted and never shown", async () => {
    expect(mailEnabled()).toBe(false);
    const res = await put(alice, { "smtp.host": "smtp.example.test", "smtp.port": 2525, "smtp.from": "TasksPipes <tasks@example.test>", "smtp.pass": "s3cret-pass" });
    expect(res.status).toBe(200);
    expect(res.body.changed).toEqual(expect.arrayContaining(["smtp.host", "smtp.pass"]));
    expect(config.smtp).toMatchObject({ host: "smtp.example.test", port: 2525, pass: "s3cret-pass" });
    expect(mailEnabled()).toBe(true);
    expect(find(res.body.settings, "smtp.pass")).toMatchObject({ value: null, isSet: true });
    const { rows } = await pool.query(`SELECT value::text FROM instance_settings WHERE key = 'smtp.pass'`);
    expect(rows[0].value).not.toContain("s3cret");
    // An empty secret keeps the current one.
    await put(alice, { "smtp.pass": "" });
    expect(config.smtp.pass).toBe("s3cret-pass");
    const history = (await alice.get("/api/admin/settings/history")).body;
    expect(history.find((h: { key: string }) => h.key === "smtp.pass")).toMatchObject({ to: "(set)", by: "Alice Martin" });
    expect(JSON.stringify(history)).not.toContain("s3cret");
  });

  it("refuse wrong values", async () => {
    for (const [settings, error] of [
      [{ "smtp.port": 70000 }, "Invalid value for smtp.port"],
      [{ "smtp.from": "not an address" }, "Invalid value for smtp.from"],
      [{ "outline.allowedHosts": ["ok.example.com", "bad host"] }, "Invalid value for outline.allowedHosts: bad host"],
      [{ "oidc.issuer": "ftp://idp.test" }, "Invalid value for oidc.issuer"],
      [{ "nope": true }, "Unknown setting: nope"],
    ] as const) {
      expect((await put(alice, settings)).body.error).toBe(error);
    }
  });

  it("configure push notifications: generate, save and use a VAPID key pair", async () => {
    const pair = (await alice.post("/api/admin/settings/vapid-keys")).body as { publicKey: string; privateKey: string };
    expect(Buffer.from(pair.publicKey, "base64url")).toHaveLength(65);
    expect(Buffer.from(pair.privateKey, "base64url")).toHaveLength(32);
    // Only administrators may generate a pair.
    expect((await bob.post("/api/admin/settings/vapid-keys")).status).toBe(404);

    const saved = (await put(alice, { "push.vapidPublicKey": pair.publicKey, "push.vapidPrivateKey": pair.privateKey })).body;
    expect(find(saved.settings, "push.vapidPublicKey")).toMatchObject({ value: pair.publicKey });
    expect(find(saved.settings, "push.vapidPrivateKey")).toMatchObject({ value: null, isSet: true });
    // The server now signs with the saved key, and offers its public key to the browsers (the cache was rebuilt).
    expect((await alice.get("/api/push/key")).body.publicKey).toBe(pair.publicKey);

    // A value that is not a base64url key of the right length is refused.
    expect((await put(alice, { "push.vapidPublicKey": "not a key" })).body.error).toBe("Invalid value for push.vapidPublicKey");
    expect((await put(alice, { "push.vapidPrivateKey": "too-short" })).body.error).toBe("Invalid value for push.vapidPrivateKey");
  });

  it("limit the domains people may be invited from", async () => {
    await put(alice, { "signin.emailDomains": ["example.org"] });
    expect((await bob.post("/api/invitations", { email: "someone@elsewhere.test", name: "X" })).body.error).toBe("Addresses of this domain cannot be invited here");
    await put(alice, { "smtp.host": null, "smtp.from": null });
    expect((await bob.post("/api/invitations", { email: "someone@example.org", name: "Y" })).status).toBe(200);
    await put(alice, { "signin.emailDomains": null });
  });

  it("never lock out the administrator making the change, nor every administrator", async () => {
    // Alice signs in with Outline.
    expect((await put(alice, { "outline.enabled": false })).body.error).toBe("With these settings, you could no longer sign in: change them another way first.");
    // An e-mail administrator needs e-mail to sign in.
    expect((await put(mailAdmin, { "outline.enabled": false })).body.error).toBe("With these settings, you could no longer sign in: change them another way first.");
  });

  it("turn Outline off: Outline accounts are signed out and cannot sign in again", async () => {
    await put(mailAdmin, { "smtp.host": "smtp.example.test", "smtp.from": "tasks@example.test" });
    expect((await put(mailAdmin, { "outline.enabled": false })).status).toBe(200);
    expect(config.outlineEnabled).toBe(false);
    expect((await alice.get("/api/me")).status).toBe(401);
    expect((await bob.post("/api/auth/apikey", { token: "bob-token" })).body.error).toBe("API key sign-in is disabled");
    expect((await bob.get("/api/auth/config")).body).toMatchObject({ oauth: false, apiKey: false });
    expect((await mailAdmin.get("/api/me")).body.features.outline).toBe(false);
    expect((await put(mailAdmin, { "outline.enabled": true })).status).toBe(200);
    alice = await signIn("alice-token");
    expect((await alice.get("/api/me")).status).toBe(200);
  });
});
