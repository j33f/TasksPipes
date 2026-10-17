import dns from "node:dns/promises";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { config } from "./config.js";
import type { Params } from "./errors.js";

export class OutlineError extends Error {
  constructor(
    public status: number,
    message: string,
    public params?: Params
  ) {
    super(message);
  }
}

export interface OutlineUser {
  id: string;
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
  isSuspended?: boolean;
}

export interface OutlineDocument {
  id: string;
  title: string;
  url: string;
  updatedAt?: string;
  collectionId?: string;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

// ---------------------------------------------------------------------------
// Outline servers: the configured one, and others people sign in with.

/** Private, loopback, link-local… addresses: never reached on behalf of a user-given server. */
const PRIVATE = new net.BlockList();
for (const [a, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) {
  PRIVATE.addSubnet(a, p, "ipv4");
}
for (const [a, p] of [["::", 127], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) PRIVATE.addSubnet(a, p, "ipv6");

export function isPrivateIp(ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPrivateIp(mapped[1]);
  return PRIVATE.check(ip, net.isIPv6(ip) ? "ipv6" : "ipv4");
}

const isDefault = (instance: string) => Boolean(config.outlineUrl) && instance === config.outlineUrl;

/** Refuses a server whose name points to an internal address (checked on each call, against DNS tricks). */
async function assertPublicHost(instance: string) {
  if (config.outlineAllowPrivate) return;
  const host = new URL(instance).hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new OutlineError(400, "Server not found: {host}", { host });
  if (addresses.some(isPrivateIp)) throw new OutlineError(400, "This Outline server is not allowed (internal address).");
}

const hostAllowed = (host: string) =>
  !config.outlineAllowedHosts.length ||
  config.outlineAllowedHosts.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h));

/** Validates a server address typed on the login page; returns its canonical URL (https, no trailing slash). */
export async function normalizeOutlineUrl(input: unknown): Promise<string> {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) {
    if (config.outlineUrl) return config.outlineUrl;
    throw new OutlineError(400, "Outline server address required");
  }
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new OutlineError(400, "Invalid Outline server address");
  }
  const url = `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  if (isDefault(url) || isDefault(u.origin)) return config.outlineUrl;
  if (u.protocol !== "https:" && !(config.outlineAllowPrivate && u.protocol === "http:")) throw new OutlineError(400, "The Outline server must use https://");
  if (u.username || u.password) throw new OutlineError(400, "Invalid Outline server address");
  if (!hostAllowed(u.hostname)) throw new OutlineError(400, "This Outline server is not allowed here.");
  await assertPublicHost(url);
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * DNS lookup for the connections to user-given servers: the address actually connected to is the one checked, so a
 * name that resolves to a public address when checked and to an internal one when connecting (DNS rebinding) fails.
 */
export function publicLookup(hostname: string, options: LookupOptions, callback: LookupCallback) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    if (!config.outlineAllowPrivate && addresses.some((a) => isPrivateIp(a.address))) {
      return callback(Object.assign(new Error("internal address"), { code: "EPRIVATE" }), []);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const MAX_RESPONSE = 20 * 1024 * 1024;

/** POSTs JSON to a user-given server, through publicLookup, without following redirects. */
function postToUserServer(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === "https:" ? https : http).request(
      u,
      { method: "POST", headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) }, lookup: publicLookup, timeout: 15_000 },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_RESPONSE) req.destroy(new Error("response too large"));
          else chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 502, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

/** Calls an Outline RPC-style API method (POST /api/<method>) on a server (the configured one by default). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function outlineApi<T = any>(token: string, method: string, body: object = {}, instance = config.outlineUrl): Promise<{ data: T }> {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };
  const unreachable = (err: Error & { cause?: { message?: string }; code?: string }) => {
    if (err.code === "EPRIVATE") throw new OutlineError(400, "This Outline server is not allowed (internal address).");
    throw new OutlineError(502, "Outline server unreachable: {cause}", { cause: err.cause?.message ?? err.message });
  };
  let status: number;
  let text: string;
  if (isDefault(instance)) {
    // The server configured by the instance (possibly on an internal address, OUTLINE_API_URL).
    const res = await fetch(`${config.outlineApiUrl}/api/${method}`, {
      method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(15_000),
    }).catch(unreachable);
    status = res.status;
    text = await res.text().catch(() => "");
  } else {
    // A server typed on the sign-in page: checked by name first (clear errors), then at each connection.
    await assertPublicHost(instance);
    ({ status, text } = await postToUserServer(`${instance}/api/${method}`, headers, JSON.stringify(body)).catch(unreachable));
  }
  let json: { ok?: boolean; message?: string; error?: string; data: T };
  try {
    json = JSON.parse(text);
  } catch {
    json = {} as typeof json;
  }
  if (status < 200 || status >= 300 || json.ok === false) {
    throw new OutlineError(status, json.message || json.error || `Outline API error ${status}`);
  }
  return json;
}

/** Exchanges an OAuth authorization code or a refresh token for tokens. */
export async function outlineToken(params: Record<string, string>): Promise<OAuthTokens> {
  const res = await fetch(`${config.outlineApiUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.oauthClientId,
      client_secret: config.oauthClientSecret,
      ...params,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<OAuthTokens> & { error_description?: string; message?: string };
  if (!res.ok || !json.access_token) {
    throw new OutlineError(res.status, json.error_description || json.message || "OAuth token exchange failed");
  }
  return json as OAuthTokens;
}

export function absoluteOutlineUrl(path?: string | null, instance = config.outlineUrl): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${instance}${path.startsWith("/") ? "" : "/"}${path}`;
}
