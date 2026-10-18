import { describe, expect, it } from "vitest";
import { absoluteOutlineUrl, normalizeOutlineUrl } from "./outline.js";
import { isPrivateIp } from "./net.js";

const reject = async (input: string) => {
  try {
    await normalizeOutlineUrl(input);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

describe("isPrivateIp", () => {
  it("spots internal addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.10", "172.20.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("lets public addresses through", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
});

describe("normalizeOutlineUrl", () => {
  it("returns the configured server for its own address", async () => {
    expect(await normalizeOutlineUrl("outline.test/")).toBe("https://outline.test");
    expect(await normalizeOutlineUrl("")).toBe("https://outline.test");
  });

  it("refuses plain http, credentials and internal addresses", async () => {
    expect(await reject("http://docs.example.com")).toBe("The Outline server must use https://");
    expect(await reject("https://user:pw@docs.example.com")).toBe("Invalid Outline server address");
    expect(await reject("https://127.0.0.1")).toBe("This Outline server is not allowed (internal address).");
    expect(await reject("https://[::1]")).toBe("This Outline server is not allowed (internal address).");
  });
});

describe("absoluteOutlineUrl", () => {
  it("prefixes paths with the server, keeps absolute links", () => {
    expect(absoluteOutlineUrl("/doc/a")).toBe("https://outline.test/doc/a");
    expect(absoluteOutlineUrl("doc/a", "https://other.test")).toBe("https://other.test/doc/a");
    expect(absoluteOutlineUrl("https://x.test/doc")).toBe("https://x.test/doc");
    expect(absoluteOutlineUrl(null)).toBeNull();
  });
});
