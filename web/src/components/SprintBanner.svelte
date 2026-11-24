<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { formatDate, localDay } from "../lib/constants";
  import { t, tn } from "../lib/i18n.svelte";
  import { capacity, openSprints, sprintDay, sprintStats } from "../lib/sprints";
  import type { PipeDetail, Sprint } from "../lib/types";
  import Icon from "./Icon.svelte";
  import SprintModal from "./SprintModal.svelte";
  import CloseSprintModal from "./CloseSprintModal.svelte";
  import SprintReportModal from "./SprintReportModal.svelte";

  /** The sprint a board shows: where it stands, and what its members can do with it. */
  let { pipe, sprint }: { pipe: PipeDetail; sprint: Sprint } = $props();

  const settings = $derived(pipe.sprintSettings);
  const stats = $derived(sprintStats(pipe.tasks, sprint.id));
  const day = $derived(sprintDay(sprint, localDay(), settings?.workDays ?? [1, 2, 3, 4, 5]));
  const cap = $derived(capacity(pipe));
  const next = $derived(openSprints(pipe.sprints ?? []).find((s) => s.status === "planned" && s.id !== sprint.id) ?? null);
  // Done points over all points: for a closed sprint, those kept when it closed.
  const total = $derived(sprint.status === "closed" ? (sprint.report?.committed ?? 0) : stats.points);
  const done = $derived(sprint.status === "closed" ? (sprint.completedPoints ?? 0) : stats.donePoints);
  const ratio = $derived(total ? Math.min(1, done / total) : 0);
  let editing = $state(false);
  let closing = $state(false);
  let report = $state(false);
  let busy = $state(false);

  async function start() {
    busy = true;
    try {
      await api.post(`/sprints/${sprint.id}/start`);
      app.toast(t("{name} started", { name: sprint.name }));
      app.refresh();
    } catch (err) {
      app.toast(errorMessage(err), "error");
    } finally {
      busy = false;
    }
  }
</script>

<section class="sprint-banner" aria-label={sprint.name}>
  <div class="head">
    <strong class="name">{sprint.name}</strong>
    <span class="state {sprint.status}">{sprint.status === "active" ? t("Under way") : sprint.status === "planned" ? t("Planned") : t("Closed")}</span>
    <span class="muted dates">{formatDate(sprint.startsOn)} – {formatDate(sprint.endsOn)}</span>
    {#if sprint.status === "active" && day.total}
      <span class="muted">{t("Day {day} of {total}", { day: day.day, total: day.total })}</span>
    {/if}
    <span class="spacer"></span>
    {#if sprint.status !== "planned"}
      <button class="btn small neutral" onclick={() => (report = true)}>
        <Icon name="chart" size={14} />{sprint.status === "closed" ? t("Report") : t("Burndown")}</button>
    {/if}
    {#if pipe.canManage && !pipe.archived}
      {#if sprint.status === "planned"}
        <button class="btn small" disabled={busy || pipe.sprints?.some((s) => s.status === "active")} onclick={start}
          title={pipe.sprints?.some((s) => s.status === "active") ? t("Close the sprint under way first") : undefined}>
          <Icon name="play" size={14} />{t("Start the sprint")}</button>
      {:else if sprint.status === "active"}
        <button class="btn small" onclick={() => (closing = true)}><Icon name="check" size={14} />{t("Close the sprint")}</button>
      {/if}
      <button class="btn small neutral icon" title={t("Edit the sprint")} aria-label={t("Edit the sprint")} onclick={() => (editing = true)}>
        <Icon name="edit" size={14} />
      </button>
    {/if}
  </div>
  {#if sprint.goal}<p class="goal"><Icon name="flag" size={13} />{sprint.goal}</p>{/if}
  <div class="progress-row">
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={total} aria-valuenow={done} aria-label={t("Points done")}>
      <span style="width:{ratio * 100}%"></span>
    </div>
    <span class="figures">{t("{done} / {total} pts", { done, total })}</span>
    {#if sprint.status !== "closed"}
      {#if cap !== null}
        <span class="muted" class:over={stats.points > cap}
          title={pipe.velocity?.source === "learned" ? t("Learned from the last sprints") : undefined}>{t("velocity {n}", { n: cap })}</span>
      {/if}
      {#if stats.unestimated}<span class="muted">{tn(stats.unestimated, "{n} task without points", "{n} tasks without points")}</span>{/if}
    {:else if sprint.report}
      <span class="muted">{tn(sprint.report.carried, "{n} task carried over", "{n} tasks carried over")}</span>
    {/if}
  </div>
</section>

{#if editing}<SprintModal pipeId={pipe.id} {sprint} onclose={() => (editing = false)} />{/if}
{#if report}<SprintReportModal {sprint} onclose={() => (report = false)} />{/if}
{#if closing}<CloseSprintModal {sprint} tasks={pipe.tasks} {next} onclose={() => (closing = false)} />{/if}

<style>
  .sprint-banner {
    background: var(--background-secondary); border-radius: 10px; padding: 10px 14px; margin-bottom: 12px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; }
  .name { font-size: 15px; }
  .state { font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 9px; background: var(--background-tertiary); color: var(--text-secondary); }
  .state.active { background: #9e5cf7; color: #fff; }
  .state.closed { background: #2a9d63; color: #fff; }
  .dates { white-space: nowrap; }
  .goal { margin: 0; display: flex; gap: 6px; align-items: baseline; font-size: 14px; color: var(--text-secondary); }
  .progress-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; }
  .bar { flex: 1 1 160px; max-width: 360px; height: 8px; border-radius: 4px; background: var(--background-tertiary); overflow: hidden; }
  .bar span { display: block; height: 100%; background: #2a9d63; border-radius: 4px; }
  .figures { font-weight: 600; font-variant-numeric: tabular-nums; }
  .over { color: var(--danger, #ed2651); font-weight: 600; }
</style>
