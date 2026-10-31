import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/svelte";
import AdminBackups from "./AdminBackups.svelte";
import type { BackupRun, BackupStatus } from "../lib/types";

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const run = (over: Partial<BackupRun> = {}): BackupRun => ({
  id: Math.random().toString(36), kind: "backup", origin: "scheduled", startedAt: ago(2), finishedAt: ago(2), ok: true,
  file: "taskspipes-backup-0.21.0-20261110-033000.tar.gz.gpg", size: 2_400_000, encrypted: true, appVersion: "0.21.0", host: "srv",
  remote: "s3:bucket/taskspipes", remoteOk: true, error: null, ...over,
});
const status = (over: Partial<BackupStatus> = {}): BackupStatus => {
  const runs = over.runs ?? [run()];
  return {
    plan: { schedule: "daily", at: "03:30", keep: 14, encrypted: true, remote: "s3:bucket/taskspipes", remoteKeep: 30, updatedAt: ago(100) },
    last: runs[0] ?? null, lastOk: runs.find((r) => r.ok) ?? null, runs, problem: null, ...over,
  };
};

afterEach(cleanup);

describe("backups in the administration", () => {
  it("show the plan, the last good backup and the recent ones", () => {
    render(AdminBackups, { status: status() });
    expect(screen.getByText("Every day at 03:30")).toBeTruthy();
    expect(screen.getByText("Encrypted with a passphrase")).toBeTruthy();
    expect(screen.getAllByText("s3:bucket/taskspipes").length).toBeGreaterThan(0);
    expect(screen.getByText("taskspipes-backup-0.21.0-20261110-033000.tar.gz.gpg")).toBeTruthy();
    expect(screen.getByText("Planned backup")).toBeTruthy();
    expect(screen.getByText("Copied")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("warn when the last backup failed, with its error", () => {
    const failed = run({ ok: false, error: "pg_dump: connection refused", file: null, size: null, remote: null, remoteOk: null });
    render(AdminBackups, { status: status({ runs: [failed, run({ finishedAt: ago(30) })], problem: "failed" }) });
    expect(screen.getByRole("alert").textContent).toContain("The last backup failed.");
    expect(screen.getByRole("alert").textContent).toContain("pg_dump: connection refused");
  });

  it("warn when the off-site copy failed, or backups are late", () => {
    render(AdminBackups, { status: status({ runs: [run({ remoteOk: false, error: "403 Forbidden" })], problem: "remote-failed" }) });
    expect(screen.getByRole("alert").textContent).toContain("its off-site copy failed");
    cleanup();
    render(AdminBackups, { status: status({ runs: [run({ finishedAt: ago(60) })], problem: "stale" }) });
    expect(screen.getByRole("alert").textContent).toContain("Backups are late.");
  });

  it("tell how to plan them when there are none", () => {
    render(AdminBackups, { status: { plan: null, last: null, lastOk: null, runs: [], problem: null } });
    expect(screen.getByText("This instance has not been backed up yet.")).toBeTruthy();
    expect(screen.getByText(/taskspipes-backup --setup/)).toBeTruthy();
    expect(screen.getByText("None yet.")).toBeTruthy();
  });
});
