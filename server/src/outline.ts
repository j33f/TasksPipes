import { config } from "./config.js";

export class OutlineError extends Error {
  constructor(
    public status: number,
    message: string
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

/** Calls an Outline RPC-style API method (POST /api/<method>). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function outlineApi<T = any>(token: string, method: string, body: object = {}): Promise<{ data: T }> {
  const res = await fetch(`${config.outlineApiUrl}/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
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

export function absoluteOutlineUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${config.outlineUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}
