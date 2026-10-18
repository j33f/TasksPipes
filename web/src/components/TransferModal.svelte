<script lang="ts">
  import Modal from "./Modal.svelte";
  import { api, ApiError, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { t, tn } from "../lib/i18n.svelte";
  import type { ImportPreview, PipeDetail } from "../lib/types";

  let { pipe, onclose }: { pipe: PipeDetail; onclose: () => void } = $props();

  const canImport = $derived(pipe.canManage && !pipe.archived);

  // Import: a file, read in the browser and sent as text with how its columns map; the server checks every line.
  let source = $state<"csv" | "trello">("csv");
  let content = $state("");
  let fileName = $state("");
  let mapping = $state<Record<number, string>>({});
  let taskType = $state("");
  let columnValues = $state<Record<string, string>>({});
  let preview = $state<ImportPreview | null>(null);
  let errors = $state<{ line: number; message: string }[]>([]);
  let error = $state("");
  let busy = $state(false);

  async function pick(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return (error = t("File too large"));
    fileName = file.name;
    content = await file.text();
    source = /\.json$/i.test(file.name) ? "trello" : "csv";
    mapping = {};
    columnValues = {};
    preview = null;
    error = "";
  }

  const body = () => ({ source, content, mapping, columnValues, ...(taskType ? { taskType } : {}) });

  // The preview follows every choice.
  $effect(() => {
    if (!content) return;
    const b = body();
    const timer = setTimeout(async () => {
      try {
        const p = await api.post<ImportPreview>(`/pipes/${pipe.id}/import/preview`, b);
        preview = p;
        errors = p.errors;
        error = "";
        if (!taskType && p.taskTypes.length) taskType = p.taskTypes[0].id;
      } catch (err) {
        preview = null;
        error = errorMessage(err);
      }
    }, 250);
    return () => clearTimeout(timer);
  });

  const columnLabel = (id: string) => preview?.columns.find((c) => c.id === id)?.label ?? id;

  async function run() {
    busy = true;
    error = "";
    try {
      const r = await api.post<{ created: number }>(`/pipes/${pipe.id}/import`, body());
      app.toast(tn(r.created, "{n} task imported", "{n} tasks imported"));
      app.refresh();
      onclose();
    } catch (err) {
      error = errorMessage(err);
      if (err instanceof ApiError) errors = preview?.errors ?? [];
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={t("Export and import")} {onclose} large>
  <div class="section">
    <div class="section-title">{t("Export the tasks")}</div>
    <p class="small">{t("Every task of the pipe, with the fields of its type: CSV opens in a spreadsheet, JSON keeps the values as stored.")}</p>
    <div class="row">
      <a class="btn neutral small" href={`/api/pipes/${pipe.id}/export`} download>CSV</a>
      <a class="btn neutral small" href={`/api/pipes/${pipe.id}/export?format=json`} download>JSON</a>
    </div>
  </div>

  {#if canImport}
    <div class="section">
      <div class="section-title">{t("Import tasks")}</div>
      <p class="small">{t("A CSV file (its first line naming the columns), or a Trello board exported as JSON. Nothing is imported while a line is wrong.")}</p>
      <label class="btn neutral small file">
        {fileName || t("Choose a file…")}
        <input type="file" accept=".csv,.txt,.json,text/csv,application/json" onchange={pick} />
      </label>

      {#if preview}
        {#if source === "csv"}
          <table class="mapping">
            <thead><tr><th>{t("Column of the file")}</th><th>{t("Goes to")}</th></tr></thead>
            <tbody>
              {#each preview.headers as h, i (i)}
                <tr>
                  <td>{h || "—"}</td>
                  <td>
                    <select class="input" value={mapping[i] ?? preview.mapping[i]} aria-label={t("Goes to")}
                      onchange={(e) => (mapping = { ...mapping, [i]: (e.currentTarget as HTMLSelectElement).value })}>
                      {#each preview.targets as target (target.id)}<option value={target.id}>{target.label}</option>{/each}
                    </select>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
        {#if preview.taskTypes.length > 1}
          <div class="field">
            <label class="label-text" for="import-type">{t("Task type of lines that name none")}</label>
            <select id="import-type" class="input" bind:value={taskType}>
              {#each preview.taskTypes as tt (tt.id)}<option value={tt.id}>{tt.label}</option>{/each}
            </select>
          </div>
        {/if}
        {#if preview.columnValues.length}
          <div class="field">
            <div class="label-text">{t("Where do these go?")}</div>
            {#each preview.columnValues as v (v.value)}
              <div class="row value">
                <span>{v.value}</span>
                <select class="input" value={columnValues[v.value] ?? v.column} aria-label={v.value}
                  onchange={(e) => (columnValues = { ...columnValues, [v.value]: (e.currentTarget as HTMLSelectElement).value })}>
                  <option value="">{t("Choose a column…")}</option>
                  {#each preview.columns as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
                </select>
              </div>
            {/each}
          </div>
        {/if}

        {#if preview.tasks.length}
          <div class="label-text">{t("Preview")}</div>
          <table class="preview">
            <thead><tr><th>#</th><th>{t("Title")}</th><th>{t("Column")}</th><th>{t("Owner")}</th><th>{t("Due date")}</th></tr></thead>
            <tbody>
              {#each preview.tasks as task (task.line)}
                <tr><td class="muted">{task.line}</td><td>{task.title}</td><td>{columnLabel(task.stage)}</td><td>{task.owner ?? "—"}</td><td>{task.dueDate ?? "—"}</td></tr>
              {/each}
            </tbody>
          </table>
        {/if}
        {#if errors.length}
          <div class="callout danger errors" role="alert">
            <strong>{tn(preview.errorCount, "{n} line to correct", "{n} lines to correct")}</strong>
            <ul>{#each errors as e (e.line + e.message)}<li>{t("Line {line}: {message}", { line: e.line, message: e.message })}</li>{/each}</ul>
          </div>
        {/if}
      {/if}
      {#if error}<p class="error-text" role="alert">{error}</p>{/if}
      <div class="modal-actions">
        <button class="btn ghost" onclick={onclose}>{t("Cancel")}</button>
        <button class="btn" disabled={busy || !preview || preview.errorCount > 0 || !preview.count} onclick={run}>
          {preview ? tn(preview.count, "Import {n} task", "Import {n} tasks") : t("Import")}
        </button>
      </div>
    </div>
  {/if}
</Modal>

<style>
  .section + .section { margin-top: 24px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .file { position: relative; overflow: hidden; }
  .file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 12px 0; }
  th { text-align: left; font-weight: 500; color: var(--text-secondary); padding: 4px 8px; border-bottom: 1px solid var(--divider); }
  td { padding: 4px 8px; border-bottom: 1px solid var(--divider); }
  .mapping select, .value select { min-height: 30px; padding: 2px 8px; font-size: 14px; width: auto; }
  .value { margin: 4px 0; }
  .value span { min-width: 140px; }
  .field { margin: 12px 0; }
  .errors { display: block; }
  .errors ul { margin: 6px 0 0; padding-left: 18px; }
</style>
