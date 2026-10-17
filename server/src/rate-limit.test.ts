import { describe, expect, it } from "vitest";
import { memoryStore, rateLimit, redisStore, setRateLimitStore } from "./rate-limit.js";

const limit = { name: "t", limit: 3, windowMs: 60_000, blockMs: 1_000, maxBlockMs: 10_000 };

describe("rate limits", () => {
  it("let requests through up to the limit, then block", async () => {
    let now = 0;
    const s = memoryStore(() => now);
    expect([await s.hit("a", limit, 2), await s.hit("a", limit, 2), await s.hit("a", limit, 2)]).toEqual([0, 0, 0]);
    expect(await s.hit("a", limit, 2)).toBe(1_000);
    now = 500;
    expect(await s.hit("a", limit, 2)).toBe(500); // still blocked
    expect(await s.hit("b", limit, 2)).toBe(0); // other clients are not
  });

  it("block longer at each offence, by the backoff factor, up to the maximum", async () => {
    let now = 0;
    const s = memoryStore(() => now);
    const offend = async () => {
      let wait = 0;
      while (!(wait = await s.hit("a", limit, 3))) {}
      now += wait;
      return wait;
    };
    expect([await offend(), await offend(), await offend(), await offend()]).toEqual([1_000, 3_000, 9_000, 10_000]);
  });

  it("start a new window once the previous one is over", async () => {
    let now = 0;
    const s = memoryStore(() => now);
    for (let i = 0; i < 3; i++) await s.hit("a", limit, 2);
    now = 60_000;
    expect(await s.hit("a", limit, 2)).toBe(0);
  });

  it("can be reset", async () => {
    const s = memoryStore(() => 0);
    for (let i = 0; i < 4; i++) await s.hit("a", limit, 2);
    await s.reset("a");
    expect(await s.hit("a", limit, 2)).toBe(0);
  });
});

describe("when Redis is down", () => {
  it("fails fast instead of holding the request", async () => {
    const s = redisStore("redis://127.0.0.1:1");
    const start = Date.now();
    await expect(s.hit("a", limit, 2)).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(2_500);
    await s.close();
  });

  it("lets requests through, with a warning", async () => {
    setRateLimitStore({ hit: async () => Promise.reject(new Error("down")), reset: async () => {}, close: async () => {} });
    const warnings: unknown[] = [];
    const req = { ip: "1.2.3.4", headers: {}, log: { warn: (o: unknown) => warnings.push(o) } };
    const reply = { code: () => { throw new Error("must not answer"); } };
    await rateLimit(limit)(req as never, reply as never);
    expect(warnings).toHaveLength(1);
    setRateLimitStore(memoryStore());
  });
});
