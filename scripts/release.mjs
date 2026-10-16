#!/usr/bin/env node
/**
 * Sets the version of TasksPipes everywhere it appears: server and web package.json and lockfiles, and the
 * Licensed Work of the LICENSE (which follows the releases).
 *
 *   node scripts/release.mjs 0.5.0
 *
 * Then commit ("chore(release): 0.5.0") and tag ("v0.5.0").
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) {
  console.error("Usage: node scripts/release.mjs <major.minor.patch>");
  process.exit(1);
}

const root = new URL("..", import.meta.url);
const edit = (path, fn) => {
  const file = fileURLToPath(new URL(path, root));
  const before = readFileSync(file, "utf8");
  const after = fn(before);
  if (after === before) throw new Error(`${path}: nothing changed`);
  writeFileSync(file, after);
  console.log(`${path} → ${version}`);
};

for (const part of ["server", "web"]) {
  edit(`${part}/package.json`, (s) => s.replace(/("version": )"[^"]+"/, `$1"${version}"`));
  // The lockfile repeats the version at its top and for the root package.
  edit(`${part}/package-lock.json`, (s) =>
    s.replace(/("name": "taskspipes-[a-z]+",\n\s*"version": )"[^"]+"/g, `$1"${version}"`)
  );
}
edit("LICENSE", (s) => s.replace(/(Licensed Work:\s+TasksPipes )\S+/, `$1${version}`));
