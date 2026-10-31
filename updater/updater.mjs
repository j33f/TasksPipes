/**
 * The TasksPipes updater: a small service, next to the app, that alone holds the Docker socket. The app asks it (with
 * a shared token, on the internal network) to move to a published version; it sets TASKSPIPES_VERSION in the
 * project's .env, pulls that image, restarts the app and waits for it to be healthy — going back to the previous
 * version when it is not. It runs fixed commands (no shell) and takes nothing but a version number. Before each
 * update it backs the database up, in the project's backups/ directory.
 */
import { execFile, spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

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

/** Runs a command; `input`, if given, is written to its standard input. */
const run = (cmd, args, { input, ...opts } = {}) =>
  new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { output: `${stdout}${stderr}` }));
      else resolve(`${stdout}${stderr}`);
    });
    if (input !== undefined) child.stdin.end(input);
  });

/** pg_dump of the project's database (custom format) into a file, streamed: a database may be large. */
async function pgDump(projectDir, file) {
  const child = spawn("docker", ["compose", "--project-directory", projectDir, "exec", "-T", "db", "pg_dump", "-U", "taskspipes", "-Fc", "taskspipes"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (c) => (err = `${err}${c}`.slice(-2000)));
  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  await pipeline(child.stdout, createWriteStream(file, { mode: 0o600 }));
  const code = await exited;
  if (code !== 0) throw new Error(err.trim() || `pg_dump exited with code ${code}`);
}

// What scripts/backup.sh records too (Administration › Backups); variables quoted by psql.
const RECORD_SQL = `INSERT INTO backup_runs (kind, origin, ok, file, size_bytes, encrypted, error, started_at, finished_at, app_version, host)
VALUES ('before-update', 'updater', :'ok'::boolean, NULLIF(:'file', ''), NULLIF(:'size', '')::bigint, false, NULLIF(left(:'err', 2000), ''),
        :'started'::timestamptz, now(), NULLIF(:'ver', ''), NULLIF(:'host', ''));
`;

/**
 * The database backup made before an update: backups/taskspipes-before-update-<version>-<date>.dump (private, the
 * last `keep` of them kept), recorded in the database. Throws when it cannot be made.
 */
export function createBackup({ projectDir, exec = run, dump = pgDump, keep = 5, host = process.env.HOST_NAME || "", now = () => new Date() }) {
  const dir = join(projectDir, "backups");
  const record = (values) => {
    const args = ["compose", "--project-directory", projectDir, "exec", "-T", "db", "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "taskspipes", "-d", "taskspipes"];
    for (const [k, v] of Object.entries(values)) args.push("-v", `${k}=${v ?? ""}`);
    // An older database has no table for it: the backup is made all the same.
    return exec("docker", args, { input: RECORD_SQL }).catch(() => "");
  };
  return async function backup(from) {
    const started = now();
    const version = /^[0-9A-Za-z.+-]+$/.test(from ?? "") ? from : "unknown";
    const stamp = started.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const file = `taskspipes-before-update-${version}-${stamp}.dump`;
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);
      await dump(projectDir, join(dir, `${file}.part`));
      await rename(join(dir, `${file}.part`), join(dir, file));
      const { size } = await stat(join(dir, file));
      const old = (await readdir(dir)).filter((f) => /^taskspipes-before-update-.*\.dump$/.test(f)).sort((a, b) => stamped(b) - stamped(a));
      for (const f of old.slice(keep)) await rm(join(dir, f), { force: true });
      await record({ ok: "true", file, size, err: "", started: started.toISOString(), ver: version, host });
      return { file, size };
    } catch (err) {
      await rm(join(dir, `${file}.part`), { force: true }).catch(() => {});
      await record({ ok: "false", file: "", size: "", err: `Before the update: ${err.message}`, started: started.toISOString(), ver: version, host });
      throw err;
    }
  };
}
/** The date in a backup's name, as a number (newest is largest). */
const stamped = (name) => Number((name.match(/(\d{8})-(\d{6})\.dump$/) ?? ["", "0", "0"]).slice(1).join(""));

/**
 * One updater for one compose project. `exec` runs a command (replaced in tests), `sleep` waits.
 * State: idle → running → done | failed (nothing changed) | rolled-back (the new version did not start).
 * `self` is the updater's own service: once the app runs the new version, the updater moves to it too.
 */
export function createUpdater({ projectDir, service = "app", self = null, variable = "TASKSPIPES_VERSION", healthTimeoutMs = 180_000, exec = run, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), backup = createBackup({ projectDir, exec }) }) {
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
    if (backup) {
      try {
        const b = await backup(status.from);
        log(`Database backed up to backups/${b.file}.`);
      } catch (err) {
        log(err.output || err.message);
        log("The database could not be backed up: nothing changed.");
        return "failed";
      }
    }
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
