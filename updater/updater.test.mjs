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
async function project(answer, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "updater-"));
  await writeFile(join(dir, ".env"), "APP_URL=https://x\nTASKSPIPES_VERSION=0.17.0\n");
  const calls = [];
  const updater = createUpdater({
    ...options,
    projectDir: dir,
    healthTimeoutMs: 1000,
    sleep: async () => {},
    exec: async (cmd, args) => {
      const sub = args.slice(3).join(" ");
      calls.push({ sub, args, version: envValue(await readFile(join(dir, ".env"), "utf8"), "TASKSPIPES_VERSION") });
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

const healthy = (sub) => (sub.startsWith("config --images") ? "ghcr.io/j33f/taskspipes-updater:0.18.0\n" : sub.startsWith("ps") ? '{"State":"running","Health":"healthy"}' : "ok");
/** Until the updater has dealt with itself (after the app's update). */
const settled = async (p) => {
  await p.finished();
  for (let i = 0; i < 100 && !p.updater.status.log.some((l) => / updater (moves|could not)/.test(l)); i++) await new Promise((r) => setTimeout(r, 5));
};

test("once the app runs the new version, the updater moves to it through a detached container of its new image", async () => {
  const p = await project(healthy, { self: "updater" });
  p.updater.start("0.18.0");
  await settled(p);
  assert.equal(p.updater.status.state, "done");
  const subs = p.calls.map((c) => c.sub);
  assert.ok(subs.includes("pull updater"));
  assert.ok(subs.includes("config --images updater"));
  const run = p.calls.find((c) => c.args[0] === "run");
  assert.ok(run, "a helper container is started");
  assert.deepEqual(run.args.slice(0, 3), ["run", "--detach", "--rm"]);
  assert.ok(run.args.includes("ghcr.io/j33f/taskspipes-updater:0.18.0"));
  assert.deepEqual(run.args.slice(-5), ["up", "--detach", "--no-deps", "--no-build", "updater"]);
  assert.ok(run.args.includes(`${p.dir}:${p.dir}`));
});

test("the updater leaves itself alone after a rollback, or when told to", async () => {
  const rolled = await project((sub) => (sub.startsWith("ps") ? '{"State":"running","Health":"unhealthy"}' : "ok"), { self: "updater" });
  rolled.updater.start("0.18.0");
  await rolled.finished();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(rolled.updater.status.state, "rolled-back");
  assert.equal(rolled.calls.some((c) => c.sub === "pull updater" || c.args[0] === "run"), false);

  const off = await project(healthy, { self: "" });
  off.updater.start("0.18.0");
  await off.finished();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(off.calls.some((c) => c.sub === "pull updater" || c.args[0] === "run"), false);
});

test("an updater that cannot move says so, and the app's update stays done", async () => {
  const p = await project((sub) => (sub === "pull updater" ? Promise.reject(Object.assign(new Error("x"), { output: "denied" })) : healthy(sub)), { self: "updater" });
  p.updater.start("0.18.0");
  await settled(p);
  assert.equal(p.updater.status.state, "done");
  assert.ok(p.updater.status.log.some((l) => l.includes("could not move to version 0.18.0") && l.includes("denied")));
});
