/**
 * HTTP side of the updater (see updater.mjs). Only reachable on the compose network; every call but /healthz needs
 * the shared token (UPDATER_TOKEN, the same in the app's .env).
 *   GET  /status   what the last update did (state, versions, log)
 *   POST /update   {"version":"1.2.3"}: starts moving to that version (202), 409 while one is running
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { VERSION, createUpdater, tokenMatches } from "./updater.mjs";

const token = process.env.UPDATER_TOKEN || "";
const projectDir = process.env.PROJECT_DIR || "";
if (token.length < 24) throw new Error("UPDATER_TOKEN must be set (24 characters or more)");
if (!projectDir || !["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"].some((f) => existsSync(join(projectDir, f)))) {
  throw new Error(`PROJECT_DIR (${projectDir || "unset"}) must be the compose project's directory, mounted at the same path as on the host`);
}

const updater = createUpdater({
  projectDir,
  service: process.env.APP_SERVICE || "app",
  // Its own service, to move to the new version too ("" to never touch itself).
  self: process.env.UPDATER_SERVICE ?? "updater",
  healthTimeoutMs: Number(process.env.HEALTH_TIMEOUT || 180) * 1000,
  // The database is backed up before each update (BACKUP_BEFORE_UPDATE=false: not).
  ...(process.env.BACKUP_BEFORE_UPDATE === "false" ? { backup: null } : {}),
});

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  if (req.url === "/healthz") return send(res, 200, { ok: true });
  if (!tokenMatches(req.headers.authorization, token)) return send(res, 401, { error: "Unauthorized" });
  if (req.method === "GET" && req.url === "/status") return send(res, 200, updater.status);
  if (req.method === "POST" && req.url === "/update") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1024) req.destroy();
    });
    req.on("end", () => {
      let version;
      try {
        version = JSON.parse(body).version;
      } catch {
        /* checked below */
      }
      if (typeof version !== "string" || !VERSION.test(version)) return send(res, 400, { error: "Invalid version" });
      if (!updater.start(version)) return send(res, 409, { error: "An update is already running" });
      console.log(`Update to ${version} started`);
      send(res, 202, updater.status);
    });
    return;
  }
  send(res, 404, { error: "Not found" });
}).listen(Number(process.env.PORT || 8080), () => console.log("TasksPipes updater ready"));
