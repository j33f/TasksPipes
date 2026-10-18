import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { cleanSubscription, encryptPayload, vapidHeader, vapidKeys } from "./push.js";

const b = (s: string) => Buffer.from(s, "base64url");

/** What a browser does with a message: the reverse of encryptPayload (RFC 8291), for checking it. */
function decryptPayload(body: Buffer, uaPrivate: Buffer, auth: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const serverPublic = body.subarray(21, 21 + idlen);
  const ua = crypto.createECDH("prime256v1");
  ua.setPrivateKey(uaPrivate);
  const hmac = (k: Buffer, d: Buffer) => crypto.createHmac("sha256", k).update(d).digest();
  const secret = ua.computeSecret(serverPublic);
  const ikm = hmac(hmac(auth, secret), Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), serverPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
  const record = body.subarray(21 + idlen);
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2));
}

describe("web push messages", () => {
  // RFC 8291, appendix A: published test values, not secrets.
  const plaintext = Buffer.from("When I grow up, I want to be a watermelon");
  const server = crypto.createECDH("prime256v1");
  server.setPrivateKey(b("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")); // ggignore: public test vector of RFC 8291, appendix A
  const device = { p256dh: b("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"), auth: b("BTBZMqHH6r4Tts7J_aSIgg") }; // ggignore: public test vector of RFC 8291, appendix A
  const uaPrivate = b("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"); // ggignore: public test vector of RFC 8291, appendix A

  it("are encrypted as RFC 8291 says", () => {
    const body = encryptPayload(plaintext, device, { serverKey: server, salt: b("DGv6ra1nlYgDCS1FRnbzlw") }); // ggignore: public test vector of RFC 8291, appendix A
    expect(body.toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN" // ggignore: public test vector of RFC 8291, appendix A
    );
  });

  it("are read back by the device, with a fresh key and salt each time", () => {
    const one = encryptPayload(plaintext, device);
    const two = encryptPayload(plaintext, device);
    expect(one.equals(two)).toBe(false);
    expect(decryptPayload(one, uaPrivate, device.auth).toString()).toBe(plaintext.toString());
  });

  it("are signed with the server's VAPID key, for the push service only", () => {
    const header = vapidHeader("https://push.example.net/send/abc", Date.UTC(2026, 9, 18));
    const [, jwt, key] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(key).toBe(vapidKeys().publicKey);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(b(p).toString())).toMatchObject({ aud: "https://push.example.net", exp: Date.UTC(2026, 9, 18) / 1000 + 12 * 3600 });
    const pub = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b(key).subarray(1, 33).toString("base64url"), y: b(key).subarray(33).toString("base64url") }, format: "jwk" });
    expect(crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: "ieee-p1363" }, b(s))).toBe(true);
  });
});

describe("push subscriptions", () => {
  const device = crypto.createECDH("prime256v1");
  device.generateKeys();
  const keys = { p256dh: device.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
  it("need an https endpoint and the device's keys", () => {
    expect(cleanSubscription({ endpoint: "https://push.example.net/x", keys }).endpoint).toBe("https://push.example.net/x");
    for (const bad of [{ endpoint: "ftp://x", keys }, { endpoint: "https://x", keys: { ...keys, auth: "AA" } }, { endpoint: "https://x", keys: { ...keys, p256dh: "AAAA" } }, null]) {
      expect(() => cleanSubscription(bad)).toThrow("Invalid push subscription");
    }
  });
});
