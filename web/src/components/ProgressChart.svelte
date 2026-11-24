<script lang="ts">
  import { formatDate } from "../lib/constants";
  import { t } from "../lib/i18n.svelte";
  import type { SprintProgress } from "../lib/types";

  /**
   * The pipe's work sprint after sprint: at the end of each sprint, the points done (green, at the bottom) and still to
   * do (accent, on top). The remaining part shrinks as work is done and grows when work is added. Hover a bar for its
   * figures; the same figures in a table below.
   */
  let { rows }: { rows: SprintProgress["rows"] } = $props();

  // Drawn at the width it is given, so that text keeps its size.
  let width = $state(640);
  const W = $derived(Math.max(280, width));
  const H = 220;
  const pad = { top: 12, right: 8, bottom: 28, left: 36 };
  const GAP = 2;
  const max = $derived(Math.max(1, ...rows.map((r) => r.done + r.remaining)));
  const step = $derived(Math.max(1, Math.ceil(max / 5 / (max > 50 ? 10 : 1)) * (max > 50 ? 10 : 1)));
  const top = $derived(step * Math.ceil(max / step));
  const ticks = $derived(Array.from({ length: top / step + 1 }, (_, i) => i * step));
  const slot = $derived((W - pad.left - pad.right) / Math.max(1, rows.length));
  const bar = $derived(Math.min(48, slot * 0.6));
  const cx = (i: number) => pad.left + slot * (i + 0.5);
  const y = (v: number) => pad.top + (1 - v / top) * (H - pad.top - pad.bottom);
  const h = (v: number) => (v / top) * (H - pad.top - pad.bottom);
  const label = (r: SprintProgress["rows"][number]) => r.name ?? t("Sprint start");
  const every = $derived(Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor(W / 80)))));
  /** A bar's segment with its free end rounded (4px), its other end square. */
  function segment(x: number, yTop: number, height: number, w: number, roundTop: boolean) {
    if (height <= 0) return "";
    const r = Math.min(4, w / 2, height);
    if (!roundTop) return `M${x},${yTop}h${w}v${height}h${-w}Z`;
    return `M${x},${yTop + height}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yTop + height}Z`;
  }
  let hover = $state<number | null>(null);
  // Near an edge, the tooltip leans inwards instead of leaving the chart.
  const tipShift = (at: number) => (at < 0.25 ? "0" : at > 0.75 ? "-100%" : "-50%");
</script>

<figure class="progress">
  <div class="legend" aria-hidden="true">
    <span><i class="swatch done"></i>{t("Done")}</span>
    <span><i class="swatch todo"></i>{t("Still to do")}</span>
  </div>
  <div class="plot" bind:clientWidth={width}>
    <svg viewBox="0 0 {W} {H}" role="img" aria-label={t("Points of the pipe done and still to do at the end of each sprint")}>
      {#each ticks as v (v)}
        <line class="grid" x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} />
        <text class="tick" x={pad.left - 6} y={y(v)} dy="0.32em" text-anchor="end">{v}</text>
      {/each}
      {#each rows as r, i (i)}
        {@const x0 = cx(i) - bar / 2}
        {@const doneH = h(r.done)}
        {@const todoH = Math.max(0, h(r.remaining) - (r.done && r.remaining ? GAP : 0))}
        <g class:faded={hover !== null && hover !== i}>
          <path class="done" d={segment(x0, y(r.done), doneH, bar, !r.remaining)} />
          <path class="todo" d={segment(x0, y(r.done + r.remaining), todoH, bar, true)} />
        </g>
        {#if (i % every === 0 && rows.length - 1 - i >= every) || i === rows.length - 1}
          <text class="tick" x={cx(i)} y={H - 8} text-anchor="middle">{label(r)}</text>
        {/if}
        <rect class="hit" x={cx(i) - slot / 2} y={pad.top} width={slot} height={H - pad.top - pad.bottom} role="presentation"
          onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)} />
      {/each}
    </svg>
    {#if hover !== null}
      {@const r = rows[hover]}
      <div class="tooltip" style="left:{(cx(hover) / W) * 100}%;transform:translateX({tipShift(cx(hover) / W)})">
        <strong>{label(r)} · {formatDate(r.endsOn)}</strong>
        <div><i class="swatch done"></i>{t("Done")} <b>{r.done}</b></div>
        <div><i class="swatch todo"></i>{t("Still to do")} <b>{r.remaining}</b></div>
      </div>
    {/if}
  </div>
  <details class="data">
    <summary>{t("See the figures")}</summary>
    <table>
      <thead><tr><th>{t("Sprint")}</th><th>{t("Date")}</th><th>{t("Done")}</th><th>{t("Still to do")}</th></tr></thead>
      <tbody>{#each rows as r, i (i)}<tr><td>{label(r)}</td><td>{formatDate(r.endsOn)}</td><td>{r.done}</td><td>{r.remaining}</td></tr>{/each}</tbody>
    </table>
  </details>
</figure>

<style>
  .progress { margin: 0; --c-done: #2a9d63; --c-todo: var(--link); }
  .legend { display: flex; gap: 14px; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
  .legend span, .tooltip div { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: var(--c-todo); }
  .swatch.done { background: var(--c-done); }
  .plot { position: relative; }
  svg { width: 100%; height: auto; display: block; overflow: visible; }
  .grid { stroke: var(--divider); stroke-width: 1; }
  .tick { font-size: 11px; fill: var(--text-tertiary); font-variant-numeric: tabular-nums; }
  .done { fill: var(--c-done); }
  .todo { fill: var(--c-todo); }
  .faded { opacity: 0.45; }
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
