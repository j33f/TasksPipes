<script lang="ts">
  import { formatDate } from "../lib/constants";
  import { t } from "../lib/i18n.svelte";
  import type { BurndownPoint } from "../lib/types";
  import { num } from "../lib/sprints";

  /**
   * A sprint's burndown: the points still to do at the end of each working day (the accent line), against the ideal
   * line (dashed) and the points of all its tasks (scope, gray: it rises when tasks are added). One axis; hover a day
   * for its figures; the same figures in a table below.
   */
  let { points }: { points: BurndownPoint[] } = $props();

  // Drawn at the width it is given, so that text keeps its size.
  let width = $state(640);
  const W = $derived(Math.max(280, width));
  const H = 240;
  const pad = { top: 12, right: 16, bottom: 28, left: 36 };
  const max = $derived(Math.max(1, ...points.flatMap((p) => [p.ideal, p.remaining ?? 0, p.scope ?? 0])));
  // A round top for the axis: 5 steps.
  const step = $derived(Math.max(1, Math.ceil(max / 5 / (max > 50 ? 10 : 1)) * (max > 50 ? 10 : 1)));
  const top = $derived(step * Math.ceil(max / step));
  const x = (i: number) => pad.left + (points.length > 1 ? (i / (points.length - 1)) * (W - pad.left - pad.right) : 0);
  const y = (v: number) => pad.top + (1 - v / top) * (H - pad.top - pad.bottom);
  const path = (values: (number | null)[]) =>
    values.reduce((d, v, i) => (v === null ? d : `${d}${d && values[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`), "");
  const ticks = $derived(Array.from({ length: top / step + 1 }, (_, i) => i * step));
  const label = (p: BurndownPoint) => (p.day ? formatDate(p.day) : t("Sprint start"));
  // Day labels: a few, so they never collide.
  const every = $derived(Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(W / 90)))));
  // The last day measured (the days to come are empty).
  const last = $derived(points.reduce((at, p, i) => (p.remaining !== null ? i : at), -1));
  let hover = $state<number | null>(null);
  // Near an edge, the tooltip leans inwards instead of leaving the chart.
  const tipShift = (at: number) => (at < 0.25 ? "0" : at > 0.75 ? "-100%" : "-50%");
</script>

<figure class="burndown">
  <div class="legend" aria-hidden="true">
    <span><i class="swatch remaining"></i>{t("Remaining")}</span>
    <span><i class="swatch ideal"></i>{t("Ideal")}</span>
    <span><i class="swatch scope"></i>{t("Scope")}</span>
  </div>
  <div class="plot" bind:clientWidth={width}>
    <svg viewBox="0 0 {W} {H}" role="img" aria-label={t("Burndown: points still to do each day of the sprint")}>
      {#each ticks as v (v)}
        <line class="grid" x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} />
        <text class="tick" x={pad.left - 6} y={y(v)} dy="0.32em" text-anchor="end">{v}</text>
      {/each}
      {#each points as p, i (i)}
        {#if (i % every === 0 && points.length - 1 - i >= every) || i === points.length - 1}
          <text class="tick" x={x(i)} y={H - 8} text-anchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>{label(p)}</text>
        {/if}
      {/each}
      <path class="line scope" d={path(points.map((p) => p.scope))} />
      <path class="line ideal" d={path(points.map((p) => p.ideal))} />
      <path class="line remaining" d={path(points.map((p) => p.remaining))} />
      {#if last >= 0}
        <circle class="dot" cx={x(last)} cy={y(points[last].remaining!)} r="4" />
        <text class="end-label" x={x(last)} y={y(points[last].remaining!)} dx={last > points.length / 2 ? -8 : 8} dy="-8"
          text-anchor={last > points.length / 2 ? "end" : "start"}>{t("{n} pts", { n: points[last].remaining! })}</text>
      {/if}
      {#if hover !== null}
        <line class="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={H - pad.bottom} />
        {#if points[hover].remaining !== null}<circle class="dot" cx={x(hover)} cy={y(points[hover].remaining!)} r="4" />{/if}
      {/if}
      <!-- Hover targets: a column per point, wider than the marks. -->
      {#each points as _, i (i)}
        <rect class="hit" x={x(i) - (W - pad.left - pad.right) / Math.max(1, points.length - 1) / 2} y={pad.top}
          width={(W - pad.left - pad.right) / Math.max(1, points.length - 1)} height={H - pad.top - pad.bottom}
          role="presentation" onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)} />
      {/each}
    </svg>
    {#if hover !== null}
      {@const p = points[hover]}
      <div class="tooltip" style="left:{(x(hover) / W) * 100}%;transform:translateX({tipShift(x(hover) / W)})">
        <strong>{label(p)}</strong>
        {#if p.remaining !== null}
          <div><i class="swatch remaining"></i>{t("Remaining")} <b>{p.remaining}</b></div>
          <div><i class="swatch scope"></i>{t("Scope")} <b>{p.scope}</b></div>
        {:else}<div class="muted">{t("To come")}</div>{/if}
        <div><i class="swatch ideal"></i>{t("Ideal")} <b>{num(p.ideal)}</b></div>
      </div>
    {/if}
  </div>
  <details class="data">
    <summary>{t("See the figures")}</summary>
    <table>
      <thead><tr><th>{t("Day")}</th><th>{t("Remaining")}</th><th>{t("Ideal")}</th><th>{t("Scope")}</th></tr></thead>
      <tbody>
        {#each points as p, i (i)}
          <tr><td>{label(p)}</td><td>{p.remaining ?? "–"}</td><td>{num(p.ideal)}</td><td>{p.scope ?? "–"}</td></tr>
        {/each}
      </tbody>
    </table>
  </details>
</figure>

<style>
  .burndown { margin: 0; --c-remaining: var(--link); --c-muted: var(--text-tertiary); }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
  .legend span, .tooltip div { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { display: inline-block; width: 22px; height: 0; border-top: 2px solid var(--c-muted); }
  .swatch.remaining { border-top-color: var(--c-remaining); }
  .swatch.ideal { border-top-style: dashed; }
  .plot { position: relative; }
  svg { width: 100%; height: auto; display: block; overflow: visible; }
  .grid { stroke: var(--divider); stroke-width: 1; }
  .tick { font-size: 11px; fill: var(--text-tertiary); font-variant-numeric: tabular-nums; }
  .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .line.remaining { stroke: var(--c-remaining); }
  .line.ideal { stroke: var(--c-muted); stroke-dasharray: 5 4; stroke-width: 1.5; }
  .line.scope { stroke: var(--c-muted); stroke-width: 1.5; opacity: 0.7; }
  .dot { fill: var(--c-remaining); stroke: var(--modal-background, var(--background)); stroke-width: 2; }
  .end-label { font-size: 12px; font-weight: 600; fill: var(--text); }
  .crosshair { stroke: var(--text-tertiary); stroke-width: 1; }
  .hit { fill: transparent; }
  .tooltip {
    position: absolute; top: 4px; transform: translateX(-50%); pointer-events: none; background: var(--modal-background, var(--background));
    box-shadow: var(--menu-shadow); border-radius: 8px; padding: 6px 10px; font-size: 12px; display: flex; flex-direction: column; gap: 2px;
    white-space: nowrap; color: var(--text); z-index: 2;
  }
  .tooltip b { font-variant-numeric: tabular-nums; margin-left: auto; padding-left: 8px; }
  .data { margin-top: 6px; font-size: 13px; }
  .data summary { cursor: pointer; color: var(--text-secondary); }
  table { border-collapse: collapse; margin-top: 6px; font-variant-numeric: tabular-nums; }
  th, td { text-align: right; padding: 3px 10px; border-bottom: 1px solid var(--divider); }
  th:first-child, td:first-child { text-align: left; }
  th { font-weight: 600; color: var(--text-secondary); }
</style>
