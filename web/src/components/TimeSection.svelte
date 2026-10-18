<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { formatDate, localDay } from "../lib/constants";
  import { durationInput, formatWork, parseDuration } from "../lib/worklog";
  import type { TaskDetail, TimeEntry } from "../lib/types";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";

  /** Estimate and time logged by hand on a task (beside the time per step, computed). */
  let { task, onchange }: { task: TaskDetail; onchange: () => void } = $props();

  const canEdit = $derived(task.permissions.editContent);
  let entries = $state<TimeEntry[]>([]);
  let total = $state(0);
  let estimate = $state("");
  let spent = $state("");
  let day = $state(localDay());
  let note = $state("");
  let editingId = $state<string | null>(null);
  let error = $state("");
  let busy = $state(false);

  const load = () =>
    api.get<{ entries: TimeEntry[]; totalMinutes: number }>(`/tasks/${task.id}/time`)
      .then((r) => { entries = r.entries; total = r.totalMinutes; })
      .catch((err) => (error = errorMessage(err)));
  $effect(() => {
    void task.id;
    void task.loggedMinutes;
    load();
  });
  $effect(() => {
    estimate = durationInput(task.estimateMinutes);
  });

  const over = $derived(Boolean(task.estimateMinutes && total > task.estimateMinutes));
  const minDay = localDay(-90);

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    error = "";
    try {
      await fn();
      await load();
      onchange();
      app.refresh();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  function saveEstimate() {
    const minutes = estimate.trim() ? parseDuration(estimate) : null;
    if (estimate.trim() && minutes === null) return (error = t("Write a duration like 2h30, 1.5 or 45min"));
    if (minutes === task.estimateMinutes) return;
    run(() => api.patch(`/tasks/${task.id}`, { estimateMinutes: minutes }));
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const minutes = parseDuration(spent);
    if (minutes === null) return (error = t("Write a duration like 2h30, 1.5 or 45min"));
    const body = { minutes, spentOn: day, note };
    run(async () => {
      if (editingId) await api.patch(`/time/${editingId}`, body);
      else await api.post(`/tasks/${task.id}/time`, body);
      cancel();
    });
  }

  function edit(entry: TimeEntry) {
    editingId = entry.id;
    spent = durationInput(entry.minutes);
    day = entry.spentOn;
    note = entry.note;
  }
  function cancel() {
    editingId = null;
    spent = "";
    day = localDay();
    note = "";
  }
  const remove = (entry: TimeEntry) =>
    confirm(entry.mine ? t("Delete this time entry?") : t("Delete the time logged by {name}?", { name: entry.user.name })) &&
    run(() => api.del(`/time/${entry.id}`));
</script>

<div class="infos">
  <div class="section-title"><Icon name="history" />{t("Time")}</div>
  <div class="summary">
    <label class="estimate">
      <span class="label-text">{t("Estimate")}</span>
      {#if canEdit}
        <input class="input" bind:value={estimate} placeholder={t("e.g. 2h30")} onblur={saveEstimate} aria-label={t("Estimate")}
          onkeydown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
      {:else}
        <span>{task.estimateMinutes ? formatWork(task.estimateMinutes) : "—"}</span>
      {/if}
    </label>
    <div class="logged" class:over>
      <span class="label-text">{t("Logged")}</span>
      <span>{formatWork(total) + (task.estimateMinutes ? ` / ${formatWork(task.estimateMinutes)}` : "")}</span>
      {#if over}<span class="small">{t("Over the estimate")}</span>{/if}
    </div>
  </div>

  {#if entries.length}
    <ul class="entries">
      {#each entries as entry (entry.id)}
        <li>
          <Avatar user={entry.user} size={18} />
          <span class="who">{entry.user.name}</span>
          <span class="muted small">{formatDate(entry.spentOn)}</span>
          <strong>{formatWork(entry.minutes)}</strong>
          {#if entry.note}<span class="note muted">{entry.note}</span>{/if}
          <span class="spacer"></span>
          {#if entry.mine && canEdit}
            <button class="btn ghost icon small" title={t("Change")} onclick={() => edit(entry)}><Icon name="edit" size={14} /></button>
          {/if}
          {#if entry.canDelete}
            <button class="btn ghost icon small" title={t("Delete")} disabled={busy} onclick={() => remove(entry)}><Icon name="trash" size={14} /></button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if canEdit}
    <form class="add" onsubmit={submit}>
      <input class="input time" bind:value={spent} placeholder={t("e.g. 1h30")} aria-label={t("Time spent")} required />
      <input class="input" type="date" bind:value={day} min={minDay} max={localDay()} aria-label={t("Day")} required />
      <input class="input grow" bind:value={note} maxlength="500" placeholder={t("Note (optional)")} aria-label={t("Note (optional)")} />
      <button class="btn small" disabled={busy || !spent.trim()}>{editingId ? t("Save") : t("Log time")}</button>
      {#if editingId}<button type="button" class="btn ghost small" onclick={cancel}>{t("Cancel")}</button>{/if}
    </form>
  {/if}
  {#if error}<p class="error-text">{error}</p>{/if}
</div>

<style>
  .infos { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--divider); }
  .summary { display: flex; gap: 24px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 8px; }
  .estimate, .logged { display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
  .label-text { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
  .estimate .input { width: 120px; min-height: 30px; padding: 2px 8px; font-size: 14px; }
  .logged.over { color: var(--danger, #ed2651); }
  .entries { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
  .entries li { display: flex; align-items: center; gap: 8px; }
  .note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .spacer { flex: 1; }
  .add { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .add .input { min-height: 30px; padding: 2px 8px; font-size: 14px; width: auto; }
  .add .time { width: 90px; }
  .add .grow { flex: 1; min-width: 140px; }
</style>
