import dns from "node:dns/promises";
import net from "node:net";
import { config } from "./config.js";
import { guardedLookup, isPrivateIp, postJson, type LookupFunction } from "./net.js";
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
  config.outlineAllowedHosts.some((h) => {
    if (!h.startsWith("*.")) return host === h;
    const suffix = h.slice(2);
    return host.length > suffix.length && host.endsWith(`.${suffix}`);
  });

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

/**
 * DNS lookup for the connections to user-given Outline servers: internal addresses refused when connecting
 * (OUTLINE_ALLOW_PRIVATE aside), see net.ts.
 */
export const publicLookup: LookupFunction = (hostname, options, callback) => guardedLookup(config.outlineAllowPrivate)(hostname, options, callback);

const postToUserServer = (url: string, headers: Record<string, string>, body: string) => postJson(url, headers, body, publicLookup);

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
