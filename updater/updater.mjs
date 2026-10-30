/**
 * The TasksPipes updater: a small service, next to the app, that alone holds the Docker socket. The app asks it (with
 * a shared token, on the internal network) to move to a published version; it sets TASKSPIPES_VERSION in the
 * project's .env, pulls that image, restarts the app and waits for it to be healthy — going back to the previous
 * version when it is not. It runs fixed commands (no shell) and takes nothing but a version number.
 */
import { execFile } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

/** Whether the bearer token of a request is the expected one (compared in constant time). */
export function tokenMatches(header, expected) {
  if (!expected || typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const digest = (s) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(expected));
}

/** The value of a variable in the text of a .env file, or null. */
export function envValue(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^(["'])(.*)\1$/, "$2") : null;
}

/** The text of a .env file with a variable set (replaced where it is, or added at the end). */
export function withEnvValue(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) return text.replace(re, line);
  return `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
}

/** Health of a service from `docker compose ps --format json` (one JSON array, or one object per line). */
export function healthOf(output) {
  const text = output.trim();
  if (!text) return "missing";
  const items = text.startsWith("[") ? JSON.parse(text) : text.split("\n").map((l) => JSON.parse(l));
  const c = items[0];
  if (!c) return "missing";
  if (c.State !== "running") return c.State || "missing";
  return c.Health || "running";
}

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { output: `${stdout}${stderr}` }));
      else resolve(`${stdout}${stderr}`);
    });
  });

/**
 * One updater for one compose project. `exec` runs a command (replaced in tests), `sleep` waits.
 * State: idle → running → done | failed (nothing changed) | rolled-back (the new version did not start).
 * `self` is the updater's own service: once the app runs the new version, the updater moves to it too.
 */
export function createUpdater({ projectDir, service = "app", self = null, variable = "TASKSPIPES_VERSION", healthTimeoutMs = 180_000, exec = run, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const envFile = join(projectDir, ".env");
  const status = { state: "idle", version: null, from: null, startedAt: null, finishedAt: null, log: [] };
  const log = (line) => {
    for (const l of String(line).split("\n").filter(Boolean)) status.log.push(`${new Date().toISOString()} ${l}`);
    status.log.splice(0, Math.max(0, status.log.length - 100));
  };
  const compose = (...args) => exec("docker", ["compose", "--project-directory", projectDir, ...args]);

  async function healthy() {
    const deadline = Date.now() + healthTimeoutMs;
    for (;;) {
      const health = healthOf(await compose("ps", "--format", "json", service).catch(() => ""));
      if (health === "healthy" || health === "running") return true;
      if (health === "unhealthy" || health === "exited" || health === "dead" || Date.now() > deadline) {
        log(`The app is ${health}.`);
        return false;
      }
      await sleep(3000);
    }
  }

  async function apply(version) {
    const before = await readFile(envFile, "utf8").catch(() => "");
    status.from = envValue(before, variable) || "latest";
    log(`Updating from ${status.from} to ${version}.`);
    await writeFile(envFile, withEnvValue(before, variable, version));
    try {
      log(await compose("pull", service));
    } catch (err) {
      await writeFile(envFile, before);
      log(err.output || err.message);
      log("The new version could not be downloaded: nothing changed.");
      return "failed";
    }
    try {
      log(await compose("up", "-d", "--no-build", service));
      if (await healthy()) {
        log(`Version ${version} is running.`);
        return "done";
      }
    } catch (err) {
      log(err.output || err.message);
    }
    log(`Going back to ${status.from}.`);
    await writeFile(envFile, before);
    log(await compose("up", "-d", "--no-build", service).catch((err) => err.output || err.message));
    return "rolled-back";
  }

  /**
   * Moves the updater to the version now in .env. It cannot restart itself (stopping its container would stop the
   * command doing it), so a short-lived container of its new image does it, detached: Compose recreates the updater
   * when its image changed, and leaves it alone otherwise.
   */
  async function updateSelf(version) {
    if (!self) return;
    try {
      log(await compose("pull", self));
      const image = (await compose("config", "--images", self)).trim().split("\n")[0];
      if (!image) throw new Error(`No image for the service ${self}`);
      await exec("docker", [
        "run", "--detach", "--rm", "--name", `taskspipes-updater-restart-${Date.now()}`,
        "--volume", "/var/run/docker.sock:/var/run/docker.sock", "--volume", `${projectDir}:${projectDir}`,
        "--entrypoint", "docker", image,
        "compose", "--project-directory", projectDir, "up", "--detach", "--no-deps", "--no-build", self,
      ]);
      log(`The updater moves to version ${version} too.`);
    } catch (err) {
      log(`The updater could not move to version ${version} (the app did): ${err.output || err.message}`);
    }
  }

  return {
    status,
    /** Starts an update in the background; false when one is already running. */
    start(version) {
      if (!VERSION.test(version)) throw new Error("Invalid version");
      if (status.state === "running") return false;
      Object.assign(status, { state: "running", version, from: null, startedAt: new Date().toISOString(), finishedAt: null, log: [] });
      apply(version)
        .catch((err) => {
          log(err.message);
          return "failed";
        })
        .then(async (state) => {
          Object.assign(status, { state, finishedAt: new Date().toISOString() });
          if (state === "done") await updateSelf(version);
        });
      return true;
    },
  };
}
