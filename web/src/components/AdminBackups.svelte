<script lang="ts">
  import { formatDateTime, relativeTime } from "../lib/constants";
  import { intlLocale, t } from "../lib/i18n.svelte";
  import type { BackupRun, BackupStatus } from "../lib/types";

  let { status, error = "" }: { status: BackupStatus | null; error?: string } = $props();

  const DOC = "https://doc.taskspipes.com/self-hosting/backups";

  /** A size in the language's units: "2.4 MB", "2,4 Mo"… */
  function size(bytes: number | null) {
    if (bytes === null) return "—";
    const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
    let v = bytes;
    let i = 0;
    while (v >= 1000 && i < units.length - 1) {
      v /= 1000;
      i++;
    }
    return new Intl.NumberFormat(intlLocale(), { style: "unit", unit: units[i], unitDisplay: "short", maximumFractionDigits: i ? 1 : 0 }).format(v);
  }

  function kind(r: BackupRun) {
    switch (r.kind) {
      case "backup": return r.origin === "scheduled" ? t("Planned backup") : t("Backup by hand");
      case "before-update": return t("Before an update");
      case "before-restore": return t("Before a restore");
      case "before-install": return t("Before the installer");
      case "restore": return t("Restore");
      default: return r.kind;
    }
  }

  function schedule(p: NonNullable<BackupStatus["plan"]>) {
    if (p.schedule === "daily") return p.at ? t("Every day at {time}", { time: p.at }) : t("Every day");
    if (p.schedule === "weekly") return p.at ? t("Every Sunday at {time}", { time: p.at }) : t("Every week");
    return t("No automatic backup");
  }
</script>

<section class="backups">
  {#if error}<p class="error-text">{error}</p>{/if}
  {#if status}
    {#if status.problem === "failed"}
      <div class="callout danger" role="alert">
        <div>
          <strong>{t("The last backup failed.")}</strong>
          {#if status.last?.error}<div class="small"><code>{status.last.error}</code></div>{/if}
          <div class="small">{t("Check the backup log on the server, then make one again: taskspipes-backup")}</div>
        </div>
      </div>
    {:else if status.problem === "remote-failed"}
      <div class="callout danger" role="alert">
        <div>
          <strong>{t("The last backup was made, but its off-site copy failed.")}</strong>
          {#if status.last?.error}<div class="small"><code>{status.last.error}</code></div>{/if}
          <div class="small">{t("It is kept on the server only: check the storage settings (taskspipes-backup --setup).")}</div>
        </div>
      </div>
    {:else if status.problem === "stale"}
      <div class="callout warning" role="alert">
        <div>
          <strong>{t("Backups are late.")}</strong>
          <div class="small">{t("No backup came as planned: is the server's timer still running? (taskspipes-backup --status)")}</div>
        </div>
      </div>
    {:else if !status.plan || status.plan.schedule === "none"}
      <div class="callout info">
        <div>
          <strong>{status.lastOk ? t("Backups are only made by hand, and before updates.") : t("This instance has not been backed up yet.")}</strong>
          <div class="small">{t("Plan them on the server, encrypted and copied to S3-compatible storage if you wish: taskspipes-backup --setup")}</div>
        </div>
      </div>
    {/if}

    <dl class="summary">
      <dt>{t("Automatic backups")}</dt>
      <dd>
        {status.plan ? schedule(status.plan) : t("No automatic backup")}
        {#if status.plan?.keep}<span class="muted small">· {t("the last {n} kept on the server", { n: status.plan.keep })}</span>{/if}
      </dd>
      <dt>{t("Encryption")}</dt>
      <dd>{status.plan?.encrypted ? t("Encrypted with a passphrase") : t("Not encrypted")}</dd>
      <dt>{t("Off-site copy")}</dt>
      <dd>
        {#if status.plan?.remote}<code>{status.plan.remote}</code>
          {#if status.plan.remoteKeep}<span class="muted small">· {t("the last {n} kept there", { n: status.plan.remoteKeep })}</span>{/if}
        {:else}{t("None")}{/if}
      </dd>
      <dt>{t("Last good backup")}</dt>
      <dd>
        {#if status.lastOk}
          <span title={formatDateTime(status.lastOk.finishedAt)}>{relativeTime(status.lastOk.finishedAt)}</span>
          <span class="muted small">· {size(status.lastOk.size)}{#if status.lastOk.appVersion} · {status.lastOk.appVersion}{/if}</span>
        {:else}{t("never")}{/if}
      </dd>
    </dl>

    <h2>{t("Recent backups")}</h2>
    {#if !status.runs.length}<p class="muted">{t("None yet.")}</p>{:else}
      <div class="table-wrap">
        <table>
          <thead><tr><th>{t("When")}</th><th>{t("What")}</th><th>{t("Result")}</th><th>{t("Size")}</th><th>{t("Encrypted")}</th><th>{t("Off-site copy")}</th><th>{t("File")}</th></tr></thead>
          <tbody>
            {#each status.runs as r (r.id)}
              <tr>
                <td class="small" title={formatDateTime(r.finishedAt)}>{relativeTime(r.finishedAt)}</td>
                <td class="small">{kind(r)}</td>
                <td class="small">
                  {#if r.ok}<span class="ok">{t("Done")}</span>{:else}<span class="ko" title={r.error ?? ""}>{t("Failed")}</span>{/if}
                </td>
                <td class="small">{size(r.size)}</td>
                <td class="small">{r.kind === "restore" ? "—" : r.encrypted ? t("Yes") : t("No")}</td>
                <td class="small">
                  {#if !r.remote}—{:else if r.remoteOk}<span class="ok">{t("Copied")}</span>{:else}<span class="ko" title={r.error ?? ""}>{t("Failed")}</span>{/if}
                </td>
                <td class="small file"><code>{r.file ?? "—"}</code></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    <p class="muted small">
      {t("Backups are made on the server: the app shows what they did, and tells the administrators when one fails.")}
      <a href={DOC} target="_blank" rel="noopener">{t("Backups, restore and moving to another server")}</a>
    </p>
  {/if}
</section>

<style>
  .summary { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0 0 20px; font-size: 14px; }
  .summary dt { color: var(--text-secondary); }
  .summary dd { margin: 0; }
  h2 { font-size: 15px; font-weight: 600; margin: 8px 0; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-weight: 500; color: var(--text-secondary); padding: 8px; border-bottom: 1px solid var(--divider); }
  td { padding: 8px; border-bottom: 1px solid var(--divider); vertical-align: top; }
  .file code { word-break: break-all; }
  .ok { color: var(--success); }
  .ko { color: var(--danger); font-weight: 500; }
  .callout code { word-break: break-word; }
</style>
