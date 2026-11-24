<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { formatDate } from "../lib/constants";
  import { t, tn } from "../lib/i18n.svelte";
  import type { BurndownPoint, DoneBy, Sprint } from "../lib/types";
  import Modal from "./Modal.svelte";
  import BurndownChart from "./BurndownChart.svelte";
  import OutlinePublish from "./OutlinePublish.svelte";

  /** A sprint's burndown — live for the one under way — and, once closed, its report. */
  let { sprint, pipeId, onclose }: { sprint: Sprint; pipeId: string; onclose: () => void } = $props();

  let points = $state<BurndownPoint[] | null>(null);
  let error = $state("");
  $effect(() => {
    api.get<BurndownPoint[]>(`/sprints/${sprint.id}/burndown`).then((p) => (points = p)).catch((err) => (error = errorMessage(err)));
  });
  const r = $derived(sprint.report);
  const added = $derived(r && r.scopeStart !== undefined && r.scopeEnd !== undefined ? r.scopeEnd - r.scopeStart : null);
  const typeLabel = (id: string) => app.taskType(id)?.label ?? id;
</script>

{#snippet table(title: string, rows: DoneBy[], name: (key: string) => string)}
  <h3>{title}</h3>
  <table class="by">
    <thead><tr><th></th><th>{t("Points done")}</th><th>{t("Tasks done")}</th></tr></thead>
    <tbody>{#each rows as row (row.key)}<tr><td>{name(row.key)}</td><td>{row.donePoints} / {row.points}</td><td>{row.done} / {row.tasks}</td></tr>{/each}</tbody>
  </table>
{/snippet}

<Modal title={sprint.status === "closed" ? t("Report of {name}", { name: sprint.name }) : t("Burndown of {name}", { name: sprint.name })} {onclose} large>
  <p class="muted small dates">{formatDate(sprint.startsOn)} – {formatDate(sprint.endsOn)}{#if sprint.goal}{" · "}{sprint.goal}{/if}</p>
  {#if r}
    <dl class="summary">
      <div><dt>{t("Committed")}</dt><dd>{t("{n} pts", { n: r.committed })}</dd></div>
      <div><dt>{t("Done")}</dt><dd>{t("{n} pts", { n: r.completed })}</dd></div>
      <div><dt>{t("Carried over")}</dt><dd>{t("{n} pts", { n: r.carriedPoints })}<span class="muted">{" · "}{tn(r.carried, "{n} task", "{n} tasks")}</span></dd></div>
      {#if added}<div><dt>{t("Added during the sprint")}</dt><dd>{added > 0 ? "+" : ""}{t("{n} pts", { n: added })}</dd></div>{/if}
      {#if r.velocity?.value !== null && r.velocity?.value !== undefined}<div><dt>{t("Velocity after it")}</dt><dd>{t("{n} pts", { n: r.velocity.value })}</dd></div>{/if}
    </dl>
  {/if}
  {#if error}<div class="error-text">{error}</div>
  {:else if points}<BurndownChart {points} />
  {:else}<p class="muted">{t("Loading…")}</p>{/if}
  {#if r?.byOwner?.length}{@render table(t("Done per person"), r.byOwner, (k) => k || t("Unassigned"))}{/if}
  {#if r?.byType?.length}{@render table(t("Done per task type"), r.byType, typeLabel)}{/if}
  {#if r && r.carriedTo}<p class="muted small">{t("Unfinished tasks went to {name}.", { name: r.carriedTo.name })}</p>{/if}
  {#if sprint.status === "closed"}<div class="export"><OutlinePublish {pipeId} path={`/sprints/${sprint.id}/report/outline`} /></div>{/if}
</Modal>

<style>
  .dates { margin: -4px 0 12px; }
  .export { margin-top: 16px; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin: 0 0 16px; }
  .summary div { background: var(--background-secondary); border-radius: 8px; padding: 8px 10px; }
  .summary dt { font-size: 12px; color: var(--text-tertiary); }
  .summary dd { margin: 2px 0 0; font-weight: 600; font-variant-numeric: tabular-nums; }
  h3 { font-size: 14px; margin: 18px 0 6px; }
  .by { border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  .by th, .by td { text-align: right; padding: 3px 12px; border-bottom: 1px solid var(--divider); }
  .by th:first-child, .by td:first-child { text-align: left; padding-left: 0; }
  .by th { font-weight: 600; color: var(--text-secondary); }
</style>
