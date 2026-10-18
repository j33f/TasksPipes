import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { domainAllowed, oidcTransport, resetOidcCache, verifyIdToken } from "./oidc.js";
import { isInstanceAdmin } from "./admin.js";

const ISSUER = "https://idp.test/realms/acme";
const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = (k: crypto.KeyObject, kid: string) => ({ ...k.export({ format: "jwk" }), kid });
let published: object[];
let jwksCalls = 0;

const b64u = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sign(claims: object, { alg = "RS256", kid = "r1", key = rsa.privateKey }: { alg?: string; kid?: string; key?: crypto.KeyObject } = {}) {
  const head = b64u({ alg, kid, typ: "JWT" });
  const body = b64u(claims);
  const sig = alg === "none" ? Buffer.alloc(0)
    : crypto.sign("sha256", Buffer.from(`${head}.${body}`), alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key);
  return `${head}.${body}.${sig.toString("base64url")}`;
}
const now = Date.UTC(2026, 9, 18, 12);
const claims = (over: object = {}) => ({ iss: ISSUER, aud: "tasks-pipes", sub: "u-42", exp: now / 1000 + 300, iat: now / 1000, nonce: "n0nce", ...over });

const saved = { ...config.oidc };
beforeAll(() => {
  Object.assign(config.oidc, { issuer: ISSUER, clientId: "tasks-pipes", clientSecret: "s", enabled: true, allowedDomains: [] });
  oidcTransport.fetch = async (url: string) => {
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/certs` });
    }
    jwksCalls++;
    return Response.json({ keys: published });
  };
});
beforeEach(() => {
  resetOidcCache();
  published = [jwk(rsa.publicKey, "r1"), jwk(ec.publicKey, "e1")];
  jwksCalls = 0;
});
afterAll(() => Object.assign(config.oidc, saved));

describe("ID tokens", () => {
  it("are accepted when signed by the provider's keys (RS256, ES256) with the right claims", async () => {
    expect((await verifyIdToken(sign(claims({ email: "ann@acme.test" })), "n0nce", now)).email).toBe("ann@acme.test");
    expect((await verifyIdToken(sign(claims(), { alg: "ES256", kid: "e1", key: ec.privateKey }), "n0nce", now)).sub).toBe("u-42");
  });

  it("are refused when forged, unsigned, or meant for someone else", async () => {
    const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const refused: [string, string][] = [
      [sign(claims(), { key: other.privateKey }), "Invalid ID token signature"],
      [sign(claims(), { alg: "none" }), "Unsupported ID token algorithm"],
      [sign(claims(), { alg: "HS256" }), "Unsupported ID token algorithm"],
      [sign(claims({ iss: "https://evil.test" })), "ID token from another issuer"],
      [sign(claims({ aud: "someone-else" })), "ID token for another client"],
      [sign(claims({ aud: ["tasks-pipes", "other"], azp: "other" })), "ID token for another client"],
      [sign(claims({ exp: now / 1000 - 120 })), "Expired ID token"],
      [sign(claims({ nonce: "replayed" })), "Invalid ID token nonce"],
      ["not.a-token", "Invalid ID token"],
    ];
    for (const [token, error] of refused) await expect(verifyIdToken(token, "n0nce", now), error).rejects.toThrow(error);
  });

  it("fetch the keys again once when the provider rotated them", async () => {
    const rotated = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    await verifyIdToken(sign(claims()), "n0nce", now);
    published = [jwk(rotated.publicKey, "r2")];
    expect((await verifyIdToken(sign(claims(), { kid: "r2", key: rotated.privateKey }), "n0nce", now)).sub).toBe("u-42");
    expect(jwksCalls).toBe(2);
    await expect(verifyIdToken(sign(claims(), { kid: "r9" }), "n0nce", now)).rejects.toThrow("Unknown ID token key");
  });
});

describe("OIDC accounts", () => {
  it("are limited to some domains when asked", () => {
    expect(domainAllowed(undefined)).toBe(true);
    config.oidc.allowedDomains = ["acme.test"];
    expect(domainAllowed("Ann@ACME.test")).toBe(true);
    expect(domainAllowed("ann@evil.test")).toBe(false);
    expect(domainAllowed(undefined)).toBe(false);
    config.oidc.allowedDomains = [];
  });

  it("are administrators only with an address the configured provider vouched for", () => {
    const admin = config.adminEmails[0] ?? "boss@acme.test";
    if (!config.adminEmails.length) config.adminEmails.push(admin);
    expect(isInstanceAdmin({ email: admin, auth_kind: "oidc", oidc_issuer: ISSUER, oidc_email_verified: true })).toBe(true);
    expect(isInstanceAdmin({ email: admin, auth_kind: "oidc", oidc_issuer: ISSUER, oidc_email_verified: false })).toBe(false);
    expect(isInstanceAdmin({ email: admin, auth_kind: "oidc", oidc_issuer: "https://other.test", oidc_email_verified: true })).toBe(false);
  });
});
