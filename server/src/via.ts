/**
 * The access token a request came with, for as long as it is handled: what a person does through an application
 * (an access token, an agent over MCP) is recorded in the task's history as done "via" it (routes.ts recordEvent).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance } from "fastify";

const store = new AsyncLocalStorage<{ id: string; kind: string } | null>();

/** The id of the access token of the request being handled, or null (a session). */
export const viaToken = (): string | null => store.getStore()?.id ?? null;

/** What the request being handled came through: an AI agent (MCP), another access token, or null (a page). */
export const viaKind = (): "agent" | "token" | null => {
  const t = store.getStore();
  return t ? (t.kind === "agent" ? "agent" : "token") : null;
};

/** Runs `fn` as if it came through this access token (work done outside a request: the instance's AI replies). */
export const runVia = <T>(token: { id: string; kind: string }, fn: () => Promise<T>): Promise<T> => store.run(token, fn);

/** Wraps every route registered after it, so that its handler runs with the request's token known. */
export function trackVia(app: FastifyInstance) {
  app.addHook("onRoute", (route) => {
    if ((route as { websocket?: boolean }).websocket) return;
    const handler = route.handler;
    route.handler = function (this: unknown, req, reply) {
      const t = req.apiToken;
      return store.run(t ? { id: t.id, kind: t.kind } : null, () => (handler as (...a: unknown[]) => unknown).call(this, req, reply));
    } as typeof handler;
  });
}
