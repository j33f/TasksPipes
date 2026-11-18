/**
 * The access token a request came with, for as long as it is handled: what a person does through an application
 * (an access token, an agent over MCP) is recorded in the task's history as done "via" it (routes.ts recordEvent).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance } from "fastify";

const store = new AsyncLocalStorage<string | null>();

/** The id of the access token of the request being handled, or null (a session). */
export const viaToken = (): string | null => store.getStore() ?? null;

/** Wraps every route registered after it, so that its handler runs with the request's token known. */
export function trackVia(app: FastifyInstance) {
  app.addHook("onRoute", (route) => {
    if ((route as { websocket?: boolean }).websocket) return;
    const handler = route.handler;
    route.handler = function (this: unknown, req, reply) {
      return store.run(req.apiToken?.id ?? null, () => (handler as (...a: unknown[]) => unknown).call(this, req, reply));
    } as typeof handler;
  });
}
