/**
 * Rate limiting of the routes that accept a token or send e-mails, per client address, with a growing block:
 * past `limit` requests in a window, the address is blocked for `blockMs`, then `blockMs × factor` at the next
 * offence, and so on (RATE_LIMIT_BACKOFF_FACTOR), up to `maxBlockMs`; offences are forgotten after a day.
 * Counters live in Redis (REDIS_URL), shared by every instance of the app; without Redis, in memory.
 * If Redis cannot be reached, requests go through (limits are a protection, not a feature) and a warning is logged.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { createClient } from "redis";
import { config } from "./config.js";
import { tr, localeOf } from "./i18n.js";

export interface Limit {
  /** Name of the counter, e.g. "unsubscribe". */
  name: string;
  limit: number;
  windowMs: number;
  blockMs: number;
  maxBlockMs?: number;
}

const STRIKES_MS = 86_400_000;

interface Store {
  /** Counts a hit; returns 0 if allowed, else how long the caller is blocked (ms). */
  hit(key: string, l: Required<Limit>, factor: number): Promise<number>;
  reset(key: string): Promise<void>;
  close(): Promise<void>;
}

// Same logic as the memory store, atomic in Redis. KEYS: count, block, strikes.
// ARGV: limit, window, block, factor, max block, strikes lifetime.
const SCRIPT = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then return blocked end
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
if n <= tonumber(ARGV[1]) then return 0 end
local strikes = redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], ARGV[6])
local ms = math.floor(math.min(tonumber(ARGV[3]) * tonumber(ARGV[4]) ^ (strikes - 1), tonumber(ARGV[5])))
redis.call('SET', KEYS[2], '1', 'PX', ms)
redis.call('DEL', KEYS[1])
return ms`;

export function redisStore(url: string): Store {
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
    async hit(key, l, factor) {
      const ms = await (await ready()).eval(SCRIPT, {
        keys: keys(key),
        arguments: [l.limit, l.windowMs, l.blockMs, factor, l.maxBlockMs, STRIKES_MS].map(String),
      });
      return Number(ms);
    },
    async reset(key) {
      await (await ready()).del(keys(key));
    },
    async close() {
      const c = client;
      client = null;
      if (c) await c.close().catch(() => c.destroy());
    },
  };
}

export function memoryStore(now = () => Date.now()): Store {
  const counts = new Map<string, { n: number; until: number }>();
  const blocks = new Map<string, number>();
  const strikes = new Map<string, { n: number; until: number }>();
  return {
    async hit(key, l, factor) {
      const t = now();
      const blocked = (blocks.get(key) ?? 0) - t;
      if (blocked > 0) return blocked;
      let c = counts.get(key);
      if (!c || c.until <= t) counts.set(key, (c = { n: 0, until: t + l.windowMs }));
      if (++c.n <= l.limit) return 0;
      let s = strikes.get(key);
      if (!s || s.until <= t) s = { n: 0, until: 0 };
      strikes.set(key, (s = { n: s.n + 1, until: t + STRIKES_MS }));
      const ms = Math.floor(Math.min(l.blockMs * factor ** (s.n - 1), l.maxBlockMs));
      blocks.set(key, t + ms);
      counts.delete(key);
      // Keep the maps small: forget what has expired.
      if (counts.size > 10_000) for (const [k, v] of counts) if (v.until <= t) counts.delete(k);
      if (strikes.size > 10_000) for (const [k, v] of strikes) if (v.until <= t) strikes.delete(k);
      return ms;
    },
    async reset(key) {
      counts.delete(key);
      blocks.delete(key);
      strikes.delete(key);
    },
    async close() {},
  };
}

let store: Store = config.redisUrl ? redisStore(config.redisUrl) : memoryStore();

/** Uses another store (tests). */
export function setRateLimitStore(s: Store) {
  store = s;
}

export const closeRateLimits = () => store.close();

const full = (l: Limit): Required<Limit> => ({ maxBlockMs: 86_400_000, ...l });

/** Counts a request of `key` (usually the client address) against a limit: 0 if allowed, else the wait in ms. */
export async function checkRate(l: Limit, key: string): Promise<number> {
  return store.hit(`${l.name}:${key}`, full(l), config.rateLimitBackoffFactor);
}

export const resetRate = (l: Limit, key: string) => store.reset(`${l.name}:${key}`);

/** A preHandler answering 429 (with Retry-After) once the client address is over the limit. */
export function rateLimit(l: Limit) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    let wait = 0;
    try {
      wait = await checkRate(l, req.ip);
    } catch (err) {
      req.log.warn({ err, limit: l.name }, "Rate limit store unavailable, request let through");
      return;
    }
    if (wait > 0) {
      return reply
        .code(429)
        .header("Retry-After", String(Math.ceil(wait / 1000)))
        .send({ error: tr(localeOf(req), "Too many requests: please try again later") });
    }
  };
}
