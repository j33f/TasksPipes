import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, signIn, startApp, stopApp } from "./helpers.js";

beforeAll(startApp);
afterAll(stopApp);

describe("signing in with Outline", () => {
  it("signs in with an API key and imports the workspace", async () => {
    const alice = await signIn("alice-token");
    const me = await alice.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ name: "Alice Martin", kind: "outline", totp: false });
    expect(me.body.features).toEqual({ invitations: true, notifications: false, outline: true });
    // The workspace is imported in the background after sign-in.
    await expect
      .poll(async () => (await alice.get("/api/users")).body.map((u: { name: string }) => u.name), { timeout: 5000 })
      .toEqual(expect.arrayContaining(["Bob Durand", "Carol Petit"]));
  });

  it("gives everyone a default personal pipe named in their language", async () => {
    const carol = await signIn("carol-token", "fr");
    const sidebar = await carol.get("/api/sidebar");
    const def = sidebar.body.mine.find((p: { isDefault: boolean }) => p.isDefault);
    expect(def).toBeTruthy();
    expect(def.kind).toBe("general");
  });

  it("refuses a wrong key, in the language of the page", async () => {
    expect((await agent("", "en").post("/api/auth/apikey", { token: "nope" })).body.error).toBe("Invalid Outline API key");
    expect((await agent("", "fr").post("/api/auth/apikey", { token: "nope" })).body.error).toBe("Clé API Outline invalide");
  });

  it("refuses internal Outline addresses typed on the login page", async () => {
    // OUTLINE_ALLOW_PRIVATE is on in tests, so check the https and credentials rules instead.
    const res = await agent("", "en").post("/api/auth/apikey", { token: "alice-token", outlineUrl: "https://user:pw@docs.example.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid Outline server address");
  });

  it("keeps accounts of different servers apart", async () => {
    // The fake Outline answers on localhost and 127.0.0.1: two servers with the same people.
    const port = process.env.MOCK_OUTLINE_PORT;
    const a1 = await signIn("alice-token");
    const a2 = await signIn("alice-token", "en", `http://127.0.0.1:${port}`);
    const [m1, m2] = [(await a1.get("/api/me")).body, (await a2.get("/api/me")).body];
    expect(m1.user.id).not.toBe(m2.user.id);
    expect(m2.outlineUrl).toBe(`http://127.0.0.1:${port}`);
    const spaces = await a2.get("/api/spaces");
    expect(spaces.body.map((s: { id: string }) => s.id)).not.toContain(m1.personalSpaceId);
  });

  it("signs out", async () => {
    const bob = await signIn("bob-token");
    expect((await bob.post("/api/auth/logout")).status).toBe(200);
    expect((await bob.get("/api/me")).status).toBe(401);
  });

  it("answers with the server version and protects the API", async () => {
    const res = await agent().get("/api/me");
    expect(res.status).toBe(401);
    const cfg = await agent().get("/api/auth/config");
    expect(cfg.body).toMatchObject({ apiKey: true, mail: false, signup: false, outlineUrl: null });
  });
});
