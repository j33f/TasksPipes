import { describe, expect, it } from "vitest";
import { backupEmail, backupProblem, type BackupPlan, type BackupRun } from "./backups.js";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const plan = (schedule: BackupPlan["schedule"], updatedHoursAgo = 1000): BackupPlan => ({
  schedule, at: "03:30", keep: 14, encrypted: true, remote: null, remoteKeep: null, updatedAt: hoursAgo(updatedHoursAgo),
});
const run = (over: Partial<BackupRun> = {}): BackupRun => ({
  id: "r", kind: "backup", origin: "scheduled", startedAt: hoursAgo(1), finishedAt: hoursAgo(1), ok: true, file: "f.tar.gz.gpg",
  size: 1000, encrypted: true, appVersion: "0.21.0", host: "h", remote: null, remoteOk: null, error: null, ...over,
});

describe("the state of the backups", () => {
  it("is fine without a plan, or with recent backups", () => {
    expect(backupProblem(null, null, null, NOW)).toBeNull();
    expect(backupProblem(plan("none"), null, null, NOW)).toBeNull();
    expect(backupProblem(plan("daily"), run(), run(), NOW)).toBeNull();
    expect(backupProblem(plan("weekly"), run({ finishedAt: hoursAgo(24 * 7) }), run({ finishedAt: hoursAgo(24 * 7) }), NOW)).toBeNull();
  });

  it("tells a failed backup, or a failed off-site copy", () => {
    expect(backupProblem(plan("daily"), run({ ok: false, error: "boom" }), run({ finishedAt: hoursAgo(25) }), NOW)).toBe("failed");
    expect(backupProblem(null, run({ ok: false }), null, NOW)).toBe("failed");
    expect(backupProblem(plan("daily"), run({ remote: "s3:b/p", remoteOk: false }), run(), NOW)).toBe("remote-failed");
    expect(backupProblem(plan("daily"), run({ remote: "s3:b/p", remoteOk: true }), run(), NOW)).toBeNull();
  });

  it("tells planned backups that stopped coming, or never came", () => {
    expect(backupProblem(plan("daily"), run({ finishedAt: hoursAgo(51) }), run({ finishedAt: hoursAgo(51) }), NOW)).toBe("stale");
    expect(backupProblem(plan("weekly"), run({ finishedAt: hoursAgo(24 * 9) }), run({ finishedAt: hoursAgo(24 * 9) }), NOW)).toBe("stale");
    expect(backupProblem(plan("daily", 60), null, null, NOW)).toBe("stale");
    // Planned a moment ago: the first one has not had time to run.
    expect(backupProblem(plan("daily", 2), null, null, NOW)).toBeNull();
  });
});

describe("the e-mail telling of a backup problem", () => {
  it("says what happened, in the administrator's language, with a link to the backups", () => {
    const en = backupEmail("en", "failed", { error: "pg_dump: <connection refused>" });
    expect(en.subject).toBe("A backup of TasksPipes failed");
    expect(en.html).toContain("pg_dump: &#60;connection refused&#62;");
    expect(en.html).toContain('href="https://tasks.test/admin?tab=backups"');
    expect(backupEmail("fr", "failed", {}).subject).toBe("Une sauvegarde de TasksPipes a échoué");
    expect(backupEmail("fr", "stale", { since: null }).html).toContain("Aucune sauvegarde");
    expect(backupEmail("es", "remote-failed", {}).subject).not.toBe("The off-site copy of a TasksPipes backup failed");
  });
});
