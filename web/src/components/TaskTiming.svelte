<script lang="ts">
  import { formatDuration } from "../lib/constants";
  import { t } from "../lib/i18n.svelte";
  import type { Timing } from "../lib/types";

  /** Time spent in each step of a task, from its history. */
  let { timing }: { timing: Timing } = $props();

  const total = $derived(timing.steps.reduce((n, s) => n + s.ms, 0) || 1);
  const name = (s: { label: string | null; incoming: boolean }) => (s.incoming ? t("Incoming") : s.label ?? "—");
</script>

<div class="timing">
  {#each timing.steps as s (`${s.incoming}${s.label}`)}
    <div class="step" class:now={timing.current && timing.current.incoming === s.incoming && timing.current.label === s.label}>
      <span class="name">{name(s)}</span>
      <span class="ms">{formatDuration(s.ms)}</span>
      <span class="bar"><span style:width={`${Math.max(2, (s.ms / total) * 100)}%`}></span></span>
    </div>
  {/each}
  <div class="totals small muted">
    {#if timing.current}{t("In “{step}” for {d}", { step: name(timing.current), d: formatDuration(Date.now() - Date.parse(timing.current.since)) })}<br />{/if}
    {timing.done ? t("Lead time: {d}", { d: formatDuration(timing.leadMs) }) : t("Open for {d}", { d: formatDuration(timing.leadMs) })}
    {#if timing.cycleMs !== null} · {t("worked on for {d}", { d: formatDuration(timing.cycleMs) })}{/if}
  </div>
</div>

<style>
  .step { display: grid; grid-template-columns: 1fr auto; gap: 0 8px; font-size: 13px; margin-bottom: 6px; }
  .step.now .name { font-weight: 600; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ms { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .bar { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: var(--background-tertiary); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); border-radius: 2px; }
  .step.now .bar span { background: #3ad984; }
  .totals { margin-top: 8px; line-height: 1.5; }
</style>
