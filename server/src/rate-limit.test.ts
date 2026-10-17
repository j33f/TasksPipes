import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { HttpError } from "./errors.js";
import { localeOf, tr } from "./i18n.js";
import { memoryCounter, rateLimited, rateLimits, redisCounter, setRateLimitCounter } from "./rate-limit.js";

describe("rate limit counter", () => {
  const hit = (s: ReturnType<typeof memoryCounter>, factor = 2) => s.hit("a", 3, 1_000, 10_000, factor);

  it("counts requests up to the limit, then blocks", async () => {
    let now = 0;
    const s = memoryCounter(() => now);
    expect((await Promise.all([hit(s), hit(s), hit(s)])).map((h) => h.count)).toEqual([1, 2, 3]);
    expect(await hit(s)).toEqual({ count: 0, ttl: 1_000, blocked: true });
    now = 500;
    expect(await hit(s)).toMatchObject({ blocked: true, ttl: 500 });
    expect(await s.hit("b", 3, 1_000, 10_000, 2)).toMatchObject({ blocked: false, count: 1 }); // other clients are not
  });

  it("blocks longer at each offence, by the backoff factor, up to the maximum", async () => {
    let now = 0;
    const s = memoryCounter(() => now);
    const offend = async () => {
      let h;
      while (!(h = await hit(s, 3)).blocked) {}
      now += h.ttl;
      return h.ttl;
    };
    expect([await offend(), await offend(), await offend(), await offend()]).toEqual([1_000, 3_000, 9_000, 10_000]);
  });

  it("starts a new window once the previous one is over, and can be reset", async () => {
    let now = 0;
    const s = memoryCounter(() => now);
    for (let i = 0; i < 3; i++) await hit(s);
    now = 1_000;
    expect(await hit(s)).toMatchObject({ blocked: false, count: 1 });
    for (let i = 0; i < 3; i++) await hit(s);
    await s.reset("a");
    expect(await hit(s)).toMatchObject({ blocked: false, count: 1 });
  });

  it("fails fast when Redis is down, instead of holding the request", async () => {
    const s = redisCounter("redis://127.0.0.1:1");
    const start = Date.now();
    await expect(s.hit("a", 3, 1_000, 10_000, 2)).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(2_500);
    await s.close();
  });
});

describe("rate limited routes", () => {
  async function app() {
    const a = Fastify();
    a.setErrorHandler((err: Error & { statusCode?: number }, req, reply) =>
      reply.code(err.statusCode ?? 500).send({ error: err instanceof HttpError ? tr(localeOf(req), err.message) : err.message }));
    await rateLimits(a);
    a.get("/limited", rateLimited({ name: "t", max: 2, timeWindow: 60_000 }), async () => "ok");
    a.get("/free", async () => "ok");
    return a;
  }
  afterEach(() => setRateLimitCounter(memoryCounter()));

  it("answer 429 past the limit, with Retry-After, in the language of the page", async () => {
    setRateLimitCounter(memoryCounter());
    const a = await app();
    const get = (url: string) => a.inject({ url, headers: { "x-locale": "fr" } });
    expect([(await get("/limited")).statusCode, (await get("/limited")).statusCode]).toEqual([200, 200]);
    const blocked = await get("/limited");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("60");
    expect(blocked.json()).toEqual({ error: "Trop de requêtes : réessayez plus tard" });
    // Routes that do not ask for a limit have none.
    for (let i = 0; i < 5; i++) expect((await get("/free")).statusCode).toBe(200);
    await a.close();
  });

  it("let requests through when the counter is unavailable", async () => {
    setRateLimitCounter({ hit: () => Promise.reject(new Error("down")), reset: async () => {}, close: async () => {} });
    const a = await app();
    for (let i = 0; i < 4; i++) expect((await a.inject({ url: "/limited" })).statusCode).toBe(200);
    await a.close();
  });
});
