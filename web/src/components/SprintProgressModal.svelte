<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { formatDate } from "../lib/constants";
  import { t, tn } from "../lib/i18n.svelte";
  import type { SprintProgress } from "../lib/types";
  import Modal from "./Modal.svelte";
  import ProgressChart from "./ProgressChart.svelte";
  import { num } from "../lib/sprints";

  /** The pipe's work sprint after sprint, its velocity and how it was found, and the end it points to. */
  let { pipeId, weeks, onclose }: { pipeId: string; weeks: number; onclose: () => void } = $props();

  let data = $state<SprintProgress | null>(null);
  let error = $state("");
  $effect(() => {
    api.get<SprintProgress>(`/pipes/${pipeId}/sprint-progress`).then((d) => (data = d)).catch((err) => (error = errorMessage(err)));
  });
  const SOURCE = { manual: "set by hand", learned: "learned from the last sprints", initial: "the initial one, until three sprints count" };
</script>

<Modal title={t("Progress of the work")} {onclose} large>
  {#if error}<div class="error-text">{error}</div>
  {:else if !data}<p class="muted">{t("Loading…")}</p>
  {:else}
    <dl class="summary">
      <div><dt>{t("Velocity")}</dt><dd>{data.velocity.value === null ? "–" : t("{n} pts", { n: data.velocity.value })}</dd>
        <dd class="muted small">{t(SOURCE[data.velocity.source])}</dd></div>
      <div><dt>{t("Still to do")}</dt><dd>{t("{n} pts", { n: data.remaining })}</dd>
        {#if data.unestimated}<dd class="muted small">{tn(data.unestimated, "+ {n} task without points", "+ {n} tasks without points")}</dd>{/if}</div>
      <div><dt>{t("Expected end")}</dt>
        {#if data.projection}
          <dd>{formatDate(data.projection.endsOn)}</dd>
          <dd class="muted small">{tn(data.projection.sprintsLeft, "{n} more sprint", "{n} more sprints")}</dd>
        {:else}<dd>–</dd><dd class="muted small">{t("Set a velocity to see it")}</dd>{/if}
      </div>
    </dl>
    {#if data.rows.length}
      <ProgressChart rows={data.rows} />
    {:else}
      <p class="muted">{t("The chart starts with the first sprint.")}</p>
    {/if}
    {#if data.velocity.samples.length}
      <h3>{t("How the velocity is learned")}</h3>
      <p class="muted small">{t("The last sprints, in points per week. A sprint marked exceptional, or far from the others, is left out; the velocity is the average of those left that are not above their median, times {n} weeks.", { n: weeks })}</p>
      <ul class="samples">
        {#each data.velocity.samples as s (s.id)}
          <li class:out={s.excluded}>
            <span>{s.name}</span><b>{t("{n} pts/week", { n: num(s.perWeek) })}</b>
            {#if s.excluded}<span class="why">{s.excluded === "exceptional" ? t("exceptional") : t("too far from the others")}</span>{/if}
          </li>
        {/each}
      </ul>
      {#if data.velocity.perWeek !== null}<p class="small">{t("Learned: {n} pts per week.", { n: num(data.velocity.perWeek) })}</p>{/if}
    {/if}
  {/if}
</Modal>

<style>
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 0 0 16px; }
  .summary div { background: var(--background-secondary); border-radius: 8px; padding: 8px 10px; }
  .summary dt { font-size: 12px; color: var(--text-tertiary); }
  .summary dd { margin: 2px 0 0; font-weight: 600; font-variant-numeric: tabular-nums; }
  .summary dd.small { font-weight: 400; font-size: 12px; }
  h3 { font-size: 14px; margin: 18px 0 6px; }
  .samples { list-style: none; padding: 0; margin: 8px 0; display: flex; flex-direction: column; gap: 2px; font-size: 13px; max-width: 420px; }
  .samples li { display: flex; gap: 10px; align-items: baseline; }
  .samples b { margin-left: auto; font-variant-numeric: tabular-nums; }
  .samples li.out span:first-child, .samples li.out b { text-decoration: line-through; color: var(--text-tertiary); }
  .why { font-size: 12px; color: var(--text-tertiary); }
</style>
