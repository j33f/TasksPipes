/** Helpers for functional tests: one app per file, signed-in agents with their session cookie. */
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { migrate, pool } from "../../src/db.js";

let app: FastifyInstance | undefined;

export async function startApp() {
  if (!app) {
    app = await buildApp({ logger: false, web: false });
    await migrate(app.log);
  }
  return app;
}

export async function stopApp() {
  await app?.close();
  app = undefined;
  await pool.end();
}

export interface Agent {
  cookie: string;
  lang: "en" | "fr";
  get<T = any>(url: string): Promise<{ status: number; body: T }>;
  post<T = any>(url: string, body?: unknown): Promise<{ status: number; body: T }>;
  patch<T = any>(url: string, body?: unknown): Promise<{ status: number; body: T }>;
  put<T = any>(url: string, body?: unknown): Promise<{ status: number; body: T }>;
  del<T = any>(url: string): Promise<{ status: number; body: T }>;
}

/** An agent sending requests with a session cookie (empty: signed out) in a language. */
export function agent(cookie = "", lang: "en" | "fr" = "en"): Agent {
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await app!.inject({
      method: method as "GET",
      url,
      headers: { cookie: a.cookie, "x-locale": lang, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    const setCookie = res.cookies.find((c) => c.name === "tp_session");
    if (setCookie) a.cookie = `tp_session=${setCookie.value}`;
    let parsed: any = res.body;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      /* not JSON */
    }
    return { status: res.statusCode, body: parsed };
  };
  const a: Agent = {
    cookie,
    lang,
    get: (url) => call("GET", url),
    post: (url, body) => call("POST", url, body),
    patch: (url, body) => call("PATCH", url, body),
    put: (url, body) => call("PUT", url, body),
    del: (url) => call("DELETE", url),
  };
  return a;
}

/** Signs in with an API key of the fake Outline (alice-token, bob-token, carol-token). */
export async function signIn(token: "alice-token" | "bob-token" | "carol-token", lang: "en" | "fr" = "en", outlineUrl?: string) {
  const a = agent("", lang);
  const res = await a.post("/api/auth/apikey", { token, ...(outlineUrl ? { outlineUrl } : {}) });
  if (res.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(res.body)}`);
  return a;
}

/** Signs an e-mail account in with the link of an invitation (when no SMTP is set, the API returns it). */
export async function signInWithLink(link: string) {
  const a = agent();
  const res = await a.post("/api/auth/magic", { token: new URL(link).searchParams.get("token") });
  if (res.status !== 200) throw new Error(`link sign-in failed: ${JSON.stringify(res.body)}`);
  return a;
}
