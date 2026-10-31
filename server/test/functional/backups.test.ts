import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn, startApp, stopApp, type Agent } from "./helpers.js";
import { pool } from "../../src/db.js";
import { checkBackups } from "../../src/backups.js";

let alice: Agent, bob: Agent;
const sent: { to: string; subject: string }[] = [];
const send = async (_lang: string, to: string, subject: string) => void sent.push({ to, subject });

// What scripts/backup.sh writes (through psql), here straight into the tables.
const record = (over: Record<string, unknown> = {}) => {
  const r = { kind: "backup", origin: "scheduled", ok: true, file: "taskspipes-backup-0.21.0-20261110-033000.tar.gz.gpg", size_bytes: 2048, encrypted: true, remote: null, remote_ok: null, error: null, finished_at: new Date(), ...over };
  return pool.query(
    `INSERT INTO backup_runs (kind, origin, ok, file, size_bytes, encrypted, remote, remote_ok, error, started_at, finished_at, app_version, host)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, '0.21.0', 'server-1')`,
    [r.kind, r.origin, r.ok, r.file, r.size_bytes, r.encrypted, r.remote, r.remote_ok, r.error, r.finished_at]
  );
};

beforeAll(async () => {
  await startApp();
  alice = await signIn("alice-token"); // an administrator (ADMIN_EMAILS)
  bob = await signIn("bob-token");
  await pool.query(`DELETE FROM backup_runs`);
  await pool.query(`DELETE FROM backup_plan`);
});
afterAll(async () => {
  await pool.query(`DELETE FROM backup_runs`);
  await pool.query(`DELETE FROM backup_plan`);
  await stopApp();
});

describe("Backups in the administration", () => {
  it("are unknown to everyone but the administrators", async () => {
    expect((await bob.get("/api/admin/backups")).status).toBe(404);
    const res = await alice.get("/api/admin/backups");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ plan: null, last: null, lastOk: null, runs: [], problem: null });
  });

  it("show the plan and the runs, newest first", async () => {
    await pool.query(`INSERT INTO backup_plan (schedule, at, keep, encrypted, remote, remote_keep) VALUES ('daily', '03:30', 14, true, 's3:bucket/taskspipes', 30)`);
    await record({ finished_at: new Date(Date.now() - 3_600_000), remote: "s3:bucket/taskspipes", remote_ok: true });
    await record({ kind: "before-update", origin: "updater", encrypted: false, file: "taskspipes-before-update-0.20.2-20261110-120000.dump" });
    const { body } = await alice.get("/api/admin/backups");
    expect(body.plan).toMatchObject({ schedule: "daily", at: "03:30", keep: 14, encrypted: true, remote: "s3:bucket/taskspipes", remoteKeep: 30 });
    expect(body.runs.map((r: { kind: string }) => r.kind)).toEqual(["before-update", "backup"]);
    expect(body.runs[1]).toMatchObject({ ok: true, size: 2048, encrypted: true, remoteOk: true, appVersion: "0.21.0", host: "server-1" });
    expect(body.problem).toBeNull();
  });
});

describe("Backup problems", () => {
  it("are told to the administrators once", async () => {
    expect(await checkBackups(send)).toBeNull();
    await record({ ok: false, error: "pg_dump: connection refused", file: null, size_bytes: null });
    expect((await alice.get("/api/admin/backups")).body.problem).toBe("failed");
    expect(await checkBackups(send)).toBe("failed");
    expect(sent).toContainEqual({ to: "alice@example.com", subject: "A backup of TasksPipes failed" });
    expect(sent.some((m) => m.to === "bob@example.com")).toBe(false);
    const before = sent.length;
    expect(await checkBackups(send)).toBeNull();
    expect(sent).toHaveLength(before);
  });

  it("are over once a backup works again", async () => {
    await record();
    expect((await alice.get("/api/admin/backups")).body.problem).toBeNull();
    expect(await checkBackups(send)).toBeNull();
  });

  it("include planned backups that stopped coming, told once per late spell", async () => {
    await pool.query(`UPDATE backup_runs SET started_at = started_at - interval '3 days', finished_at = finished_at - interval '3 days'`);
    expect((await alice.get("/api/admin/backups")).body.problem).toBe("stale");
    sent.length = 0;
    expect(await checkBackups(send)).toBe("stale");
    expect(sent).toContainEqual({ to: "alice@example.com", subject: "TasksPipes has not been backed up as planned" });
    expect(await checkBackups(send)).toBeNull();
    // A good backup ends the spell; the next one late is told again (the notice was days ago).
    await pool.query(`UPDATE backup_plan SET stale_notified_at = now() - interval '4 days'`);
    await record();
    expect(await checkBackups(send)).toBeNull();
    await pool.query(`UPDATE backup_runs SET started_at = started_at - interval '3 days', finished_at = finished_at - interval '3 days'`);
    expect(await checkBackups(send)).toBe("stale");
  });
});
