import { describe, expect, it } from "vitest";
import { ZipWriter } from "./zip.js";
import { readZip } from "../test/zip-reader.js";

const build = (fill: (z: ZipWriter) => Buffer[][]) => {
  const z = new ZipWriter();
  return Buffer.concat([...fill(z).flat(), ...z.end()]);
};

describe("zip archives", () => {
  it("hold files that read back as written", () => {
    const big = Buffer.alloc(200_000, "abc");
    const zip = build((z) => [z.file("data.json", '{"a":1}'), z.file("files/TP-1/é.txt", "accents"), z.file("big.bin", big)]);
    const files = readZip(zip);
    expect([...files.keys()]).toEqual(["data.json", "files/TP-1/é.txt", "big.bin"]);
    expect(files.get("data.json")!.toString()).toBe('{"a":1}');
    expect(files.get("files/TP-1/é.txt")!.toString()).toBe("accents");
    expect(files.get("big.bin")!.equals(big)).toBe(true);
    expect(zip.length).toBeLessThan(big.length / 10);
  });

  it("keep names inside the archive and unique", () => {
    const zip = build((z) => [z.file("../../etc/passwd", "x"), z.file("/abs.txt", "y"), z.file("a.txt", "1"), z.file("a.txt", "2")]);
    expect([...readZip(zip).keys()]).toEqual(["_/_/etc/passwd", "abs.txt", "a.txt", "a (2).txt"]);
  });

  it("can be empty", () => {
    expect(readZip(build(() => [])).size).toBe(0);
  });
});
