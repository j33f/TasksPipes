import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { agent, signIn, signInWithLink, startApp, stopApp, type Agent } from "./helpers.js";
import { LIMITS, resetAllRates } from "../../src/rate-limit.js";
import { one, query } from "../../src/db.js";

let app: FastifyInstance, alice: Agent, bob: Agent;

beforeAll(async () => {
  app = await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
});
// Each test starts with fresh limits: they are counted per address, the same for every test.
beforeEach(resetAllRates);
afterAll(async () => {
  await resetAllRates();
  await stopApp();
});

describe("rate limits", () => {
  it("stop guessing sign-in links", async () => {
    const guest = agent();
    for (let i = 0; i < LIMITS.magic.max; i++) expect((await guest.post("/api/auth/magic", { token: `guess-${i}` })).status).toBe(400);
    const blocked = await guest.post("/api/auth/magic", { token: "one more" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("Too many requests: please try again later");
  });

  it("stop guessing two-factor codes from the settings, per person", async () => {
    for (let i = 0; i < LIMITS.totpSettings.max; i++) expect((await alice.post("/api/me/totp/disable", { code: "000000" })).status).not.toBe(429);
    expect((await alice.post("/api/me/totp/disable", { code: "000000" })).status).toBe(429);
    // Someone else is not blocked.
    expect((await bob.post("/api/me/totp/disable", { code: "000000" })).status).not.toBe(429);
  });

  it("count webhooks per pipe token, without holding one back for another", async () => {
    const hook = (token: string) => app.inject({ method: "POST", url: `/hooks/github/${token}`, payload: "{}", headers: { "content-type": "application/json" } });
    for (let i = 0; i < LIMITS.webhook.max; i++) await hook("token-a");
    expect((await hook("token-a")).statusCode).toBe(429);
    expect((await hook("token-b")).statusCode).not.toBe(429);
  });
});

describe("profile pictures", () => {
  it("refuse a declared type that is not one of the image types", async () => {
    const res = await alice.post("/api/invitations", { email: "picture@example.com", name: "Picture" });
    const guest = await signInWithLink(res.body.link);
    for (const type of ["constructor", "__proto__", "toString"]) {
      const upload = await app.inject({
        method: "POST", url: "/api/me/avatar", payload: Buffer.from("GIF8xxxx"),
        headers: { cookie: guest.cookie, "content-type": "application/octet-stream", "x-file-type": type },
      });
      expect(upload.statusCode).toBe(400);
    }
  });
});

describe("invitations by e-mail", () => {
  it("do not match an Outline account from a self-chosen server that claims someone's address", async () => {
    // An attacker signs in through their own Outline server, which asserts a victim's address: that address is
    // not theirs, so inviting it must reach a fresh account, never hand the invitation to the attacker.
    const victim = "spoof-victim@partner.example";
    const spoofer = await one(
      `INSERT INTO users (id, name, email, auth_kind, outline_url, outline_id)
       VALUES (gen_uuidv7(), 'Spoofer', $1, 'outline', 'https://attacker.example', 'spoof-1') RETURNING id`,
      [victim]
    );

    const res = await alice.post("/api/invitations", { email: victim, name: "Real Victim" });
    // A brand-new e-mail account is created, not a connection request to the spoofer.
    expect(res.body.created).toBe(true);

    const { rows } = await query(`SELECT auth_kind FROM users WHERE lower(email) = $1 ORDER BY auth_kind`, [victim]);
    expect(rows.map((r) => r.auth_kind)).toEqual(["email", "outline"]); // the new one, and the untouched spoofer
    expect((await query(`SELECT 1 FROM invitations WHERE invitee_id = $1`, [spoofer!.id])).rows).toHaveLength(0);
  });
});
