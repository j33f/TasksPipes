// cd updater && node --test
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUpdater, envValue, healthOf, tokenMatches, withEnvValue } from "./updater.mjs";

test("the token is checked", () => {
  const t = "a-long-enough-shared-token-0123";
  assert.equal(tokenMatches(`Bearer ${t}`, t), true);
  assert.equal(tokenMatches(`Bearer ${t}x`, t), false);
  assert.equal(tokenMatches(t, t), false);
  assert.equal(tokenMatches(undefined, t), false);
  assert.equal(tokenMatches("Bearer ", ""), false);
});

test(".env values are read and set", () => {
  const env = "APP_URL=https://x\nTASKSPIPES_VERSION=\"0.17.0\"\n";
  assert.equal(envValue(env, "TASKSPIPES_VERSION"), "0.17.0");
  assert.equal(envValue("A=1", "TASKSPIPES_VERSION"), null);
  assert.equal(withEnvValue(env, "TASKSPIPES_VERSION", "0.18.0"), "APP_URL=https://x\nTASKSPIPES_VERSION=0.18.0\n");
  assert.equal(withEnvValue("A=1", "TASKSPIPES_VERSION", "0.18.0"), "A=1\nTASKSPIPES_VERSION=0.18.0\n");
});

test("the app's health is read from docker compose ps", () => {
  assert.equal(healthOf('{"State":"running","Health":"healthy"}'), "healthy");
  assert.equal(healthOf('[{"State":"running","Health":"starting"}]'), "starting");
  assert.equal(healthOf('{"State":"exited","Health":""}'), "exited");
  assert.equal(healthOf('{"State":"running","Health":""}'), "running");
  assert.equal(healthOf(""), "missing");
});

/** A fake docker: answers each compose command with the given function. */
async function project(answer) {
  const dir = await mkdtemp(join(tmpdir(), "updater-"));
  await writeFile(join(dir, ".env"), "APP_URL=https://x\nTASKSPIPES_VERSION=0.17.0\n");
  const calls = [];
  const updater = createUpdater({
    projectDir: dir,
    healthTimeoutMs: 1000,
    sleep: async () => {},
    exec: async (cmd, args) => {
      const sub = args.slice(3).join(" ");
      calls.push({ sub, version: envValue(await readFile(join(dir, ".env"), "utf8"), "TASKSPIPES_VERSION") });
      return answer(sub, calls);
    },
  });
  const finished = async () => {
    while (updater.status.state === "running") await new Promise((r) => setTimeout(r, 5));
  };
  return { dir, calls, updater, finished };
}

test("an update pulls the version, restarts the app and waits for it to be healthy", async () => {
  const p = await project((sub, calls) => (sub.startsWith("ps") ? (calls.filter((c) => c.sub.startsWith("ps")).length > 1 ? '{"State":"running","Health":"healthy"}' : '{"State":"running","Health":"starting"}') : "ok"));
  assert.equal(p.updater.start("0.18.0"), true);
  assert.equal(p.updater.start("0.18.0"), false); // one at a time
  await p.finished();
  assert.equal(p.updater.status.state, "done");
  assert.equal(p.updater.status.from, "0.17.0");
  assert.deepEqual(p.calls.map((c) => [c.sub, c.version]).slice(0, 2), [["pull app", "0.18.0"], ["up -d --no-build app", "0.18.0"]]);
  assert.equal(envValue(await readFile(join(p.dir, ".env"), "utf8"), "TASKSPIPES_VERSION"), "0.18.0");
});

test("a version that cannot be downloaded changes nothing", async () => {
  const p = await project((sub) => {
    if (sub.startsWith("pull")) throw Object.assign(new Error("pull failed"), { output: "manifest unknown" });
    return "ok";
  });
  p.updater.start("9.9.9");
  await p.finished();
  assert.equal(p.updater.status.state, "failed");
  assert.equal(p.calls.some((c) => c.sub.startsWith("up")), false);
  assert.equal(envValue(await readFile(join(p.dir, ".env"), "utf8"), "TASKSPIPES_VERSION"), "0.17.0");
});

test("a version that does not start healthy is rolled back", async () => {
  const p = await project((sub) => (sub.startsWith("ps") ? '{"State":"running","Health":"unhealthy"}' : "ok"));
  p.updater.start("0.18.0");
  await p.finished();
  assert.equal(p.updater.status.state, "rolled-back");
  const ups = p.calls.filter((c) => c.sub.startsWith("up"));
  assert.deepEqual(ups.map((c) => c.version), ["0.18.0", "0.17.0"]);
  assert.equal(envValue(await readFile(join(p.dir, ".env"), "utf8"), "TASKSPIPES_VERSION"), "0.17.0");
});

test("only version numbers are taken", async () => {
  const p = await project(() => "ok");
  for (const bad of ["latest", "1.2", "1.2.3 && reboot", "../1.2.3", ""]) assert.throws(() => p.updater.start(bad));
});
