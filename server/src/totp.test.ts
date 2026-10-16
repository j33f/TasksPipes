import { afterEach, describe, expect, it, vi } from "vitest";
import { newSecret, otpauthUrl, verifyTotp } from "./totp.js";

// RFC 6238 test secret "12345678901234567890" (SHA-1), in base32.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts the RFC 6238 codes (6 last digits)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000);
    expect(verifyTotp(RFC_SECRET, "287082")).toBe(1);
    vi.setSystemTime(1_111_111_109_000);
    expect(verifyTotp(RFC_SECRET, "081804")).toBe(37_037_036);
  });

  it("tolerates one step of clock drift, not two", () => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000 + 30_000); // step 2: the step-1 code is one step late
    expect(verifyTotp(RFC_SECRET, "287082")).toBe(1);
    vi.setSystemTime(59_000 + 60_000); // step 3: two steps late
    expect(verifyTotp(RFC_SECRET, "287082")).toBeNull();
  });

  it("refuses a code already used (replay)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000);
    expect(verifyTotp(RFC_SECRET, "287082", 1)).toBeNull();
  });

  it("refuses malformed codes, accepts spaces", () => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000);
    expect(verifyTotp(RFC_SECRET, "28708")).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef")).toBeNull();
    expect(verifyTotp(RFC_SECRET, "287 082")).toBe(1);
  });

  it("makes 160-bit base32 secrets and authenticator URLs", () => {
    const s = newSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(newSecret()).not.toBe(s);
    const url = otpauthUrl(s, "gina@example.com");
    expect(url).toContain(`secret=${s}`);
    expect(url).toContain("issuer=TasksPipes");
    expect(url.startsWith("otpauth://totp/TasksPipes%3Agina%40example.com?")).toBe(true);
  });
});
