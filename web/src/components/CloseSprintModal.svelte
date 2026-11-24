<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { t, tn } from "../lib/i18n.svelte";
  import { sprintStats } from "../lib/sprints";
  import type { Sprint, Task } from "../lib/types";
  import Modal from "./Modal.svelte";

  /** Closing the sprint under way: what it achieved, and where its unfinished tasks go. */
  let { sprint, tasks, next = null, onclose }: { sprint: Sprint; tasks: Task[]; next?: Sprint | null; onclose: () => void } = $props();

  const stats = $derived(sprintStats(tasks, sprint.id));
  const unfinished = $derived(tasks.filter((x) => x.sprintId === sprint.id && x.status !== "done" && x.status !== "abandoned"));
  let destination = $state<"next" | "backlog">("next");
  let busy = $state(false);
  let error = $state("");

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      await api.post(`/sprints/${sprint.id}/close`, { unfinished: destination });
      app.toast(t("{name} closed", { name: sprint.name }));
      app.refresh();
      onclose();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={t("Close {name}", { name: sprint.name })} {onclose}>
  <form onsubmit={submit}>
    <dl class="summary">
      <div><dt>{t("Committed")}</dt><dd>{t("{n} pts", { n: sprint.committedPoints ?? 0 })}</dd></div>
      <div><dt>{t("Done")}</dt><dd>{t("{n} pts", { n: stats.donePoints })}</dd></div>
      <div><dt>{t("Unfinished")}</dt><dd>{tn(unfinished.length, "{n} task", "{n} tasks")}</dd></div>
    </dl>
    {#if unfinished.length}
      <fieldset class="field">
        <legend class="label-text">{t("Unfinished tasks go to")}</legend>
        <label class="check"><input type="radio" bind:group={destination} value="next" />
          {next ? t("The next sprint ({name})", { name: next.name }) : t("A new sprint, after this one")}</label>
        <label class="check"><input type="radio" bind:group={destination} value="backlog" />{t("The backlog")}</label>
      </fieldset>
    {/if}
    <p class="muted small">{t("Its points and a report are kept; the sprint can no longer take tasks.")}</p>
    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      <button type="button" class="btn neutral" onclick={onclose}>{t("Cancel")}</button>
      <button class="btn" disabled={busy}>{t("Close the sprint")}</button>
    </div>
  </form>
</Modal>

<style>
  .check { display: flex; align-items: center; gap: 8px; font-size: 14px; margin: 6px 0; cursor: pointer; }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0 0 16px; }
  .summary div { background: var(--background-secondary); border-radius: 8px; padding: 8px 10px; }
  .summary dt { font-size: 12px; color: var(--text-tertiary); }
  .summary dd { margin: 2px 0 0; font-weight: 600; font-variant-numeric: tabular-nums; }
  fieldset { border: 0; padding: 0; margin: 0 0 8px; }
</style>
