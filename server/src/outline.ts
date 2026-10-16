import dns from "node:dns/promises";
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

/** Calls an Outline RPC-style API method (POST /api/<method>) on a server (the configured one by default). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function outlineApi<T = any>(token: string, method: string, body: object = {}, instance = config.outlineUrl): Promise<{ data: T }> {
  if (!isDefault(instance)) await assertPublicHost(instance);
  const base = isDefault(instance) ? config.outlineApiUrl : instance;
  const res = await fetch(`${base}/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  }).catch((err: Error & { cause?: { message?: string } }) => {
    throw new OutlineError(502, "Outline server unreachable: {cause}", { cause: err.cause?.message ?? err.message });
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string; data: T };
  if (!res.ok || json.ok === false) {
    throw new OutlineError(res.status, json.message || json.error || `Outline API error ${res.status}`);
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
