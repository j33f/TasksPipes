import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";
import { runPush } from "../../src/notifications.js";
import { pushState } from "../../src/push.js";

let alice: Agent, bob: Agent, bobId: string, bobSpace: string;
const sent: { endpoint: string; headers: Record<string, string>; body: Buffer }[] = [];
let answer = 201;

// The device keys of RFC 8291, appendix A: the test plays the browser.
const uaPrivate = Buffer.from("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94", "base64url");
const keys = { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };
const endpoint = "https://push.example.net/send/bob-device";

/** What the device reads from a pushed body. */
function read(body: Buffer) {
  const hmac = (k: Buffer, d: Buffer) => crypto.createHmac("sha256", k).update(d).digest();
  const serverPublic = body.subarray(21, 21 + body[20]);
  const ua = crypto.createECDH("prime256v1");
  ua.setPrivateKey(uaPrivate);
  const ikm = hmac(hmac(Buffer.from(keys.auth, "base64url"), ua.computeSecret(serverPublic)),
    Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), serverPublic, Buffer.from([1])]));
  const prk = hmac(body.subarray(0, 16), ikm);
  const d = crypto.createDecipheriv("aes-128-gcm", hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16),
    hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12));
  const record = body.subarray(21 + body[20]);
  d.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
}

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token");
  bob = await signIn("bob-token");
  bobId = (await bob.get("/api/me")).body.user.id;
  bobSpace = (await bob.get("/api/me")).body.personalSpaceId;
  pushState.send = async (url, headers, body) => {
    sent.push({ endpoint: url, headers, body });
    return { status: answer };
  };
});
beforeEach(async () => {
  sent.length = 0;
  answer = 201;
  // Notifications of other test files are not this file's to push.
  await pool.query(`UPDATE notifications SET pushed_at = now() WHERE pushed_at IS NULL`);
});
afterAll(stopApp);

describe("push subscriptions", () => {
  it("are kept encrypted, one per device", async () => {
    expect((await bob.get("/api/push/key")).body.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect((await bob.post("/api/me/push", { endpoint, keys })).status).toBe(200);
    expect((await bob.post("/api/me/push", { endpoint, keys })).status).toBe(200);
    const { rows } = await pool.query(`SELECT data FROM push_subscriptions WHERE user_id = $1`, [bobId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].data).not.toContain("push.example.net");
    expect((await bob.post("/api/me/push", { endpoint: "http://push.example.net/x", keys: { p256dh: "x", auth: "y" } })).body.error).toBe("Invalid push subscription");
  });

  it("push what one gets at once to one's devices, readable there", async () => {
    const task = (await alice.post("/api/tasks", { title: "Read the brief", spaceId: bobSpace })).body.id;
    expect(await runPush()).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].endpoint).toBe(endpoint);
    expect(sent[0].headers).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "86400" });
    expect(sent[0].headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=B[\w-]{86}$/);
    expect(read(sent[0].body)).toMatchObject({ title: expect.stringMatching(/^New task for you: TP-\d+ Read the brief$/), body: "Alice Martin sent you this task", tag: `task-${task}` });
    // Pushed once.
    expect(await runPush()).toBe(0);
  });

  it("name a confidential task by its key only", async () => {
    const team = (await alice.post("/api/spaces", { name: "Push care", members: [{ userId: bobId }] })).body.id;
    const care = (await alice.post(`/api/spaces/${team}/pipes`, { name: "Care", kind: "sante" })).body.id;
    await alice.post("/api/tasks", { title: "Doctor secret", pipeId: care, taskType: "rdv_sante", assigneeId: bobId });
    await runPush();
    const message = read(sent[0].body);
    expect(message.title).toMatch(/^You now own TP-\d+$/);
    expect(JSON.stringify(message)).not.toContain("Doctor");
  });

  it("follow one's choices: nothing for a kind not set to at once", async () => {
    // Without e-mail on the instance, the choices are open to those with a device.
    expect((await bob.put("/api/me/notifications", { received: "digest" })).status).toBe(200);
    expect((await alice.put("/api/me/notifications", { received: "digest" })).status).toBe(404);
    await alice.post("/api/tasks", { title: "Digest only", spaceId: bobSpace });
    expect(await runPush()).toBe(0);
    await pool.query(`UPDATE users SET notification_prefs = notification_prefs - 'received' WHERE id = $1`, [bobId]);
  });

  it("forget a device the push service no longer knows", async () => {
    answer = 410;
    await alice.post("/api/tasks", { title: "Gone device", spaceId: bobSpace });
    expect(await runPush()).toBe(0);
    expect((await pool.query(`SELECT 1 FROM push_subscriptions WHERE user_id = $1`, [bobId])).rowCount).toBe(0);
  });

  it("are removed only by their owner", async () => {
    await bob.post("/api/me/push", { endpoint, keys });
    expect((await alice.del("/api/me/push", { endpoint })).status).toBe(200);
    expect((await pool.query(`SELECT 1 FROM push_subscriptions WHERE user_id = $1`, [bobId])).rowCount).toBe(1);
    await bob.del("/api/me/push", { endpoint });
    expect((await pool.query(`SELECT 1 FROM push_subscriptions WHERE user_id = $1`, [bobId])).rowCount).toBe(0);
  });

  it("queue nothing for people without devices when e-mail is off", async () => {
    await alice.post("/api/tasks", { title: "Nobody listens", spaceId: bobSpace });
    expect((await pool.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND pushed_at IS NULL`, [bobId])).rowCount).toBe(0);
  });
});
