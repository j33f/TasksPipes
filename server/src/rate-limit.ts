/**
 * Rate limiting of the routes that accept a token or send e-mails, with @fastify/rate-limit and a store of our own
 * that blocks for longer at each offence: past `max` requests in `timeWindow`, the client is blocked for
 * `timeWindow`, then `timeWindow × factor` at the next offence, and so on (RATE_LIMIT_BACKOFF_FACTOR), up to
 * `maxBlockMs`; offences are forgotten after a day. Counters live in Redis (REDIS_URL), shared by every instance of
 * the app; without Redis, in memory. If Redis cannot be reached, requests go through (limits are a protection, not
 * a feature) and a warning is logged.
 *
 * Routes opt in with `...rateLimited({ name, max, timeWindow })` in their options.
 */
import crypto from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { createClient } from "redis";
import { config } from "./config.js";
import { HttpError } from "./errors.js";

export interface Limit {
  /** Name of the counter, e.g. "unsubscribe": each route counts on its own. */
  name: string;
  /** Requests allowed per window. */
  max: number;
  /** Window, and first block, in milliseconds. */
  timeWindow: number;
  maxBlockMs?: number;
  /** What is counted: the client address by default. */
  keyGenerator?: (req: FastifyRequest) => string;
}

const STRIKES_MS = 86_400_000;
const MAX_BLOCK_MS = 86_400_000;

export interface Hit {
  /** Requests counted in the window (0 when blocked). */
  count: number;
  /** Time left in the window, or of the block. */
  ttl: number;
  blocked: boolean;
}

export interface Counter {
  hit(key: string, max: number, windowMs: number, maxBlockMs: number, factor: number): Promise<Hit>;
  reset(key: string): Promise<void>;
  /** Forgets every counter (tests). */
  clear(): Promise<void>;
  close(): Promise<void>;
}

// Same logic as the memory counter, atomic in Redis. KEYS: count, block, strikes.
// ARGV: max, window, factor, max block, strikes lifetime. Returns {count, ttl}; count -1 means blocked.
const SCRIPT = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then return {-1, blocked} end
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
if n <= tonumber(ARGV[1]) then return {n, redis.call('PTTL', KEYS[1])} end
local strikes = redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], ARGV[5])
local ms = math.floor(math.min(tonumber(ARGV[2]) * tonumber(ARGV[3]) ^ (strikes - 1), tonumber(ARGV[4])))
redis.call('SET', KEYS[2], '1', 'PX', ms)
redis.call('DEL', KEYS[1])
return {-1, ms}`;

export function redisCounter(url: string): Counter {
  let client: ReturnType<typeof createClient> | null = null;
  /** The connected client; fails within a second when Redis is down, rather than holding the request. */
  async function ready() {
    if (!client) {
      client = createClient({
        url,
        // Commands fail at once while disconnected, instead of waiting in a queue.
        disableOfflineQueue: true,
        socket: { connectTimeout: 1_000, reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, 5_000) },
      });
      client.on("error", () => {}); // reported by the callers when a command fails
      client.connect().catch(() => {});
    }
    const c = client;
    if (c.isReady) return c;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => (c.off("ready", onReady), reject(new Error("Redis is not reachable"))), 1_000);
      const onReady = () => (clearTimeout(timer), resolve());
      c.once("ready", onReady);
    });
    return c;
  }
  const keys = (key: string) => [`rl:${key}:n`, `rl:${key}:block`, `rl:${key}:strikes`];
  return {
    async hit(key, max, windowMs, maxBlockMs, factor) {
      const [count, ttl] = (await (await ready()).eval(SCRIPT, {
        keys: keys(key),
        arguments: [max, windowMs, factor, maxBlockMs, STRIKES_MS].map(String),
      })) as [number, number];
      return count < 0 ? { count: 0, ttl: Number(ttl), blocked: true } : { count: Number(count), ttl: Number(ttl), blocked: false };
    },
    async reset(key) {
      await (await ready()).del(keys(key));
    },
    async clear() {
      const c = await ready();
      for await (const batch of c.scanIterator({ MATCH: "rl:*", COUNT: 500 })) if (batch.length) await c.del(batch);
    },
    async close() {
      const c = client;
      client = null;
      if (c) await c.close().catch(() => c.destroy());
    },
  };
}

export function memoryCounter(now = () => Date.now()): Counter {
  const counts = new Map<string, { n: number; until: number }>();
  const blocks = new Map<string, number>();
  const strikes = new Map<string, { n: number; until: number }>();
  return {
    async hit(key, max, windowMs, maxBlockMs, factor) {
      const t = now();
      const blocked = (blocks.get(key) ?? 0) - t;
      if (blocked > 0) return { count: 0, ttl: blocked, blocked: true };
      let c = counts.get(key);
      if (!c || c.until <= t) counts.set(key, (c = { n: 0, until: t + windowMs }));
      if (++c.n <= max) return { count: c.n, ttl: c.until - t, blocked: false };
      let s = strikes.get(key);
      if (!s || s.until <= t) s = { n: 0, until: 0 };
      strikes.set(key, (s = { n: s.n + 1, until: t + STRIKES_MS }));
      const ms = Math.floor(Math.min(windowMs * factor ** (s.n - 1), maxBlockMs));
      blocks.set(key, t + ms);
      counts.delete(key);
      // Keep the maps small: forget what has expired.
      if (counts.size > 10_000) for (const [k, v] of counts) if (v.until <= t) counts.delete(k);
      if (strikes.size > 10_000) for (const [k, v] of strikes) if (v.until <= t) strikes.delete(k);
      return { count: 0, ttl: ms, blocked: true };
    },
    async reset(key) {
      counts.delete(key);
      blocks.delete(key);
      strikes.delete(key);
    },
    async clear() {
      counts.clear();
      blocks.clear();
      strikes.clear();
    },
    async close() {},
  };
}

let counter: Counter = config.redisUrl ? redisCounter(config.redisUrl) : memoryCounter();
let log: Pick<FastifyBaseLogger, "warn"> | null = null;

/** Uses another counter (tests). */
export function setRateLimitCounter(c: Counter) {
  counter = c;
}

export const closeRateLimits = () => counter.close();

export const resetRate = (l: Pick<Limit, "name">, key: string) => counter.reset(`${l.name}:${key}`);
export const resetAllRates = () => counter.clear();

/** Counts per signed-in person (else per address). */
export const perPerson = (req: FastifyRequest) => req.user?.id ?? req.ip;

/** Counts per secret in the URL (`param`), hashed: the secret itself is never stored. */
export const perSecret = (param: string) => (req: FastifyRequest) =>
  crypto.createHash("sha256").update(String((req.params as Record<string, unknown>)[param] ?? "")).digest("hex").slice(0, 32);

const MIN = 60_000;
/** Limits of the routes that sign people in, accept a secret or check a code. */
export const LIMITS = {
  signup: { name: "signup", max: 10, timeWindow: 60 * MIN },
  signInLink: { name: "sign-in-link", max: 20, timeWindow: 15 * MIN },
  magic: { name: "magic", max: 20, timeWindow: 15 * MIN },
  totp: { name: "totp", max: 20, timeWindow: 15 * MIN },
  apiKey: { name: "api-key", max: 20, timeWindow: 15 * MIN },
  oauth: { name: "oauth", max: 30, timeWindow: 15 * MIN },
  totpSettings: { name: "totp-settings", max: 10, timeWindow: 15 * MIN, keyGenerator: perPerson },
  catalogUsage: { name: "catalog-usage", max: 60, timeWindow: MIN, keyGenerator: perPerson },
  search: { name: "search", max: 120, timeWindow: MIN, keyGenerator: perPerson },
  outlineInvite: { name: "outline-invite", max: 20, timeWindow: 60 * MIN, keyGenerator: perPerson },
  pipeExport: { name: "pipe-export", max: 60, timeWindow: 60 * MIN, keyGenerator: perPerson },
  pipeImportPreview: { name: "pipe-import-preview", max: 300, timeWindow: 60 * MIN, keyGenerator: perPerson },
  timeEntries: { name: "time-entries", max: 120, timeWindow: MIN, keyGenerator: perPerson },
  dependencies: { name: "dependencies", max: 120, timeWindow: MIN, keyGenerator: perPerson },
  pipeImport: { name: "pipe-import", max: 20, timeWindow: 60 * MIN, keyGenerator: perPerson },
  dataExport: { name: "data-export", max: 5, timeWindow: 60 * MIN, keyGenerator: perPerson },
  accountDeletion: { name: "account-deletion", max: 10, timeWindow: 15 * MIN, keyGenerator: perPerson },
  webhook: { name: "webhook", max: 600, timeWindow: MIN, keyGenerator: perSecret("token") },
  calendar: { name: "calendar", max: 60, timeWindow: MIN, keyGenerator: perSecret("file") },
  // The public API, per token (or address when the token is wrong), and the creation of tokens and webhooks.
  api: { name: "api", max: 600, timeWindow: MIN },
  apiTokens: { name: "api-tokens", max: 20, timeWindow: 60 * MIN, keyGenerator: perPerson },
  webhooks: { name: "webhooks", max: 60, timeWindow: 60 * MIN, keyGenerator: perPerson },
} satisfies Record<string, Limit>;

interface StoreParams {
  name?: string;
  maxBlockMs?: number;
}

/** Store of @fastify/rate-limit: one per limited route, named after its counter. */
class BackoffStore {
  constructor(private params: StoreParams = {}) {}

  incr(key: string, cb: (err: Error | null, res?: { current: number; ttl: number }) => void, timeWindow: number, max: number) {
    counter
      .hit(`${this.params.name ?? "global"}:${key}`, max, timeWindow, this.params.maxBlockMs ?? MAX_BLOCK_MS, config.rateLimitBackoffFactor)
      .then((h) => cb(null, { current: h.blocked ? max + 1 : h.count, ttl: h.ttl }))
      .catch((err: Error) => {
        log?.warn({ err, limit: this.params.name }, "Rate limit store unavailable, request let through");
        cb(err);
      });
  }

  child(params: StoreParams) {
    return new BackoffStore(params);
  }
}

/** Registers the rate limiter: no limit by default, routes opt in with rateLimited(). */
export async function rateLimits(app: FastifyInstance) {
  log = app.log;
  await app.register(fastifyRateLimit, {
    global: false,
    store: BackoffStore as never,
    skipOnError: true,
    errorResponseBuilder: () => new HttpError(429, "Too many requests: please try again later"),
  });
  app.addHook("onClose", closeRateLimits);
}

/** Counts a request against a limit from a hook shared by many routes (the public API); throws 429 past it. */
export async function enforceLimit(l: Limit, key: string) {
  const h = await counter
    .hit(`${l.name}:${key}`, l.max, l.timeWindow, l.maxBlockMs ?? MAX_BLOCK_MS, config.rateLimitBackoffFactor)
    .catch((err: Error) => {
      log?.warn({ err, limit: l.name }, "Rate limit store unavailable, request let through");
      return null;
    });
  if (h && (h.blocked || h.count > l.max)) throw new HttpError(429, "Too many requests: please try again later");
}

/** Route options limiting it. */
export const rateLimited = (l: Limit) => ({ config: { rateLimit: { ...l } } });
