/**
 * Web Push: notifications on the devices people turned them on for, sent while they are not in the app, for the
 * kinds they get "at once" by e-mail (notifications.ts). Messages are encrypted for the device (RFC 8291,
 * aes128gcm) and signed with the server's VAPID key (RFC 8292), derived from APP_SECRET unless VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY are set. Subscriptions are kept encrypted with APP_SECRET; their endpoint never goes to the logs.
 */
import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { one, query } from "./db.js";
import { bad } from "./errors.js";
import { decrypt, encrypt, hash } from "./auth.js";
import { guardedLookup, postJson } from "./net.js";
import { LIMITS, rateLimited } from "./rate-limit.js";

const b64u = (b: Buffer) => b.toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");
const hmac = (key: Buffer, data: Buffer) => crypto.createHmac("sha256", key).update(data).digest();

// ---------------------------------------------------------------------------
// Encryption of a message for a device (RFC 8291)

export interface DeviceKeys {
  /** The device's P-256 public key, uncompressed (65 bytes). */
  p256dh: Buffer;
  /** Its 16-byte authentication secret. */
  auth: Buffer;
}

/** The body of a push message: header (salt, record size, server key) then the encrypted record. */
export function encryptPayload(plaintext: Buffer, device: DeviceKeys, { serverKey, salt }: { serverKey?: crypto.ECDH; salt?: Buffer } = {}): Buffer {
  const ecdh = serverKey ?? crypto.createECDH("prime256v1");
  if (!serverKey) ecdh.generateKeys();
  const serverPublic = ecdh.getPublicKey();
  const s = salt ?? crypto.randomBytes(16);
  const secret = ecdh.computeSecret(device.p256dh);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), device.p256dh, serverPublic]);
  const ikm = hmac(hmac(device.auth, secret), Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(s, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  // A single record, ending with its delimiter (2), no padding.
  const record = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  s.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(serverPublic.length, 20);
  return Buffer.concat([header, serverPublic, record]);
}

// ---------------------------------------------------------------------------
// The server's VAPID key (RFC 8292)

interface Vapid {
  publicKey: string;
  key: crypto.KeyObject;
}

let vapid: Vapid | null = null;
// The private key the cache was built from, so a change in the settings rebuilds it ("\0derived": from APP_SECRET).
let vapidFrom: string | null = null;

/** The configured VAPID key (base64url), else one derived from APP_SECRET; rebuilt when the setting changes. */
export function vapidKeys(): Vapid {
  const from = config.vapidPrivateKey || "\0derived";
  if (vapid && vapidFrom === from) return vapid;
  const ecdh = crypto.createECDH("prime256v1");
  if (config.vapidPrivateKey) {
    ecdh.setPrivateKey(fromB64u(config.vapidPrivateKey));
    if (config.vapidPublicKey && !ecdh.getPublicKey().equals(fromB64u(config.vapidPublicKey))) {
      throw new Error("VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_KEY");
    }
  } else {
    ecdh.setPrivateKey(Buffer.from(crypto.hkdfSync("sha256", config.appSecret, "", "taskspipes:vapid", 32)));
  }
  const pub = ecdh.getPublicKey();
  const key = crypto.createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: b64u(ecdh.getPrivateKey()), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) },
    format: "jwk",
  });
  vapid = { publicKey: b64u(pub), key };
  vapidFrom = from;
  return vapid;
}

/** A fresh VAPID key pair (base64url), for an administrator to store in the settings. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

/** The Authorization header for a push service: a JWT signed with the VAPID key, for 12 hours. */
export function vapidHeader(endpoint: string, now = Date.now()): string {
  const { publicKey, key } = vapidKeys();
  const head = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: config.vapidSubject })));
  const signature = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${body}.${b64u(signature)}, k=${publicKey}`;
}

// ---------------------------------------------------------------------------
// Subscriptions

export interface Subscription {
  endpoint: string;
  keys: DeviceKeys;
}

/** A subscription sent by a browser: an https endpoint and the device's keys. */
export function cleanSubscription(v: unknown): Subscription {
  const o = (v && typeof v === "object" ? v : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof o.endpoint === "string" ? o.endpoint : "";
  let url: URL | null = null;
  try {
    url = new URL(endpoint);
  } catch { /* checked below */ }
  // https only (plain http too where webhooks may reach internal addresses: tests, a local push service).
  const secure = url?.protocol === "https:" || (config.webhookAllowPrivate && url?.protocol === "http:");
  if (!url || !secure || endpoint.length > 1024) throw bad("Invalid push subscription");
  const p256dh = typeof o.keys?.p256dh === "string" ? fromB64u(o.keys.p256dh) : Buffer.alloc(0);
  const auth = typeof o.keys?.auth === "string" ? fromB64u(o.keys.auth) : Buffer.alloc(0);
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) throw bad("Invalid push subscription");
  return { endpoint, keys: { p256dh, auth } };
}

/** At most this many devices per person: the oldest go. */
const MAX_DEVICES = 20;

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** Messages of the same tag replace each other on the device. */
  tag: string;
}

export type PushSend = (endpoint: string, headers: Record<string, string>, body: Buffer) => Promise<{ status: number }>;
const lookup = guardedLookup(config.webhookAllowPrivate);
const defaultSend: PushSend = (endpoint, headers, body) => postJson(endpoint, headers, body, lookup, { timeoutMs: 10_000, maxResponse: 64 * 1024 });
export const pushState: { send: PushSend } = { send: defaultSend };

/** Whether someone turned push on for a device. */
export const hasDevices = async (userId: string) => Boolean(await one(`SELECT 1 FROM push_subscriptions WHERE user_id = $1 LIMIT 1`, [userId]));

/**
 * Sends a message to every device of a person; a device the push service no longer knows (404, 410) is forgotten.
 * Returns how many devices took it.
 */
export async function pushTo(userId: string, message: PushMessage): Promise<number> {
  const { rows } = await query(`SELECT id, data FROM push_subscriptions WHERE user_id = $1`, [userId]);
  const payload = Buffer.from(JSON.stringify({ ...message, body: message.body.slice(0, 1000) }));
  let delivered = 0;
  for (const r of rows) {
    let sub: Subscription;
    try {
      const raw = JSON.parse(decrypt(r.data) ?? "");
      sub = { endpoint: raw.endpoint, keys: { p256dh: fromB64u(raw.p256dh), auth: fromB64u(raw.auth) } };
    } catch {
      // Encrypted with another APP_SECRET: the device must subscribe again.
      await query(`DELETE FROM push_subscriptions WHERE id = $1`, [r.id]);
      continue;
    }
    const headers = {
      Authorization: vapidHeader(sub.endpoint), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
      TTL: "86400", Urgency: "normal",
    };
    try {
      const { status } = await pushState.send(sub.endpoint, headers, encryptPayload(payload, sub.keys));
      if (status === 404 || status === 410) await query(`DELETE FROM push_subscriptions WHERE id = $1`, [r.id]);
      else if (status >= 200 && status < 300) {
        delivered++;
        await query(`UPDATE push_subscriptions SET last_used_at = now() WHERE id = $1`, [r.id]);
      }
    } catch {
      // Unreachable for now: tried again with the next message.
    }
  }
  return delivered;
}

type Req = FastifyRequest<{ Body: Record<string, unknown> }>;

export async function pushRoutes(app: FastifyInstance) {
  app.get("/push/key", async () => ({ publicKey: vapidKeys().publicKey }));

  // A device turns push on: kept for this person (a device used by someone else before is theirs no more).
  app.post("/me/push", rateLimited(LIMITS.pushSubscriptions), async (req: Req) => {
    const sub = cleanSubscription(req.body);
    const data = encrypt(JSON.stringify({ endpoint: sub.endpoint, p256dh: b64u(sub.keys.p256dh), auth: b64u(sub.keys.auth) }));
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint_hash, data, user_agent) VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint_hash) DO UPDATE SET user_id = $1, data = $3, user_agent = $4, created_at = now()`,
      [req.user!.id, hash(sub.endpoint), data, String(req.headers["user-agent"] ?? "").slice(0, 200)]
    );
    await query(
      `DELETE FROM push_subscriptions WHERE user_id = $1 AND id NOT IN
         (SELECT id FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT ${MAX_DEVICES})`,
      [req.user!.id]
    );
    return { ok: true };
  });

  // A device turns push off (only one's own).
  app.delete("/me/push", rateLimited(LIMITS.pushSubscriptions), async (req: Req) => {
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
    await query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint_hash = $2`, [req.user!.id, hash(endpoint)]);
    return { ok: true };
  });
}
