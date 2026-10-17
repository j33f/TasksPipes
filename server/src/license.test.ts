import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("LICENSE", () => {
  it("licenses the current release (see scripts/release.mjs)", () => {
    const { version } = JSON.parse(read("../package.json"));
    expect(read("../../LICENSE")).toMatch(new RegExp(`Licensed Work:\\s+TasksPipes ${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n`));
  });

  it("names its licensor and keeps the web app on the same version", () => {
    const license = read("../../LICENSE");
    expect(license).toMatch(/Licensor:\s+Jean-François Vial\n/);
    expect(JSON.parse(read("../../web/package.json")).version).toBe(JSON.parse(read("../package.json")).version);
  });
});
