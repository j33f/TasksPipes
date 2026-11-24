<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { formatDate, localDay } from "../lib/constants";
  import { intlLocale, t, tn } from "../lib/i18n.svelte";
  import { isoWeekday } from "../lib/sprints";
  import { dayList, daysBetween, shiftSpan, taskSpan, timelineRange, type Span } from "../lib/timeline";
  import type { PipeDetail, Sprint, Task } from "../lib/types";
  import Icon from "./Icon.svelte";

  /**
   * The timeline of a pipe in sprints: all its sprints (a band each, their tasks below; the closed ones folded), one
   * sprint, or the backlog. Bars go from a task's start to its due date (dashed where the sprint gives the date),
   * releases are milestones, arrows join a task to the ones it waits for (red when it starts before they end).
   * Members drag a bar to move it, or its ends to change its dates (not on phones: the task's page sets them there).
   */
  let { pipe, sprintId }: { pipe: PipeDetail; sprintId: string } = $props();

  const ROW = 30;
  const HEAD = 42;
  const today = localDay();
  const workDays = $derived(pipe.sprintSettings?.workDays ?? [1, 2, 3, 4, 5]);
  const sprints = $derived([...(pipe.sprints ?? [])].sort((a, b) => a.number - b.number));
  const sprintOf = (task: Task) => sprints.find((s) => s.id === task.sprintId) ?? null;

  let deps = $state<{ taskId: string; waitsFor: string }[]>([]);
  $effect(() => {
    app.version;
    api.get<typeof deps>(`/pipes/${pipe.id}/dependencies`).then((d) => (deps = d)).catch(() => (deps = []));
  });

  // Moves under way: shown at once, then saved.
  let moved = $state<Record<string, Span>>({});
  const spanOf = (task: Task) => moved[task.id] ?? taskSpan(task, sprintOf(task));

  const live = $derived(pipe.tasks.filter((x) => x.status !== "abandoned"));
  const shown = $derived(
    sprintId === "all" ? live : sprintId === "backlog" ? live.filter((x) => !x.sprintId) : live.filter((x) => x.sprintId === sprintId)
  );
  const undated = $derived(shown.filter((x) => !spanOf(x)).length);

  // Closed sprints start folded on the whole timeline.
  let folded = $state<Record<string, boolean>>({});
  const isFolded = (s: Sprint) => folded[s.id] ?? s.status === "closed";

  type Line = { kind: "sprint"; sprint: Sprint } | { kind: "backlog" } | { kind: "task"; task: Task; span: Span };
  const byStart = (a: Task, b: Task) => (spanOf(a)!.start).localeCompare(spanOf(b)!.start) || a.position - b.position;
  const lines = $derived.by((): Line[] => {
    const tasks = (list: Task[]) => list.filter((x) => spanOf(x)).sort(byStart).map((task): Line => ({ kind: "task", task, span: spanOf(task)! }));
    if (sprintId !== "all") return tasks(shown);
    const out: Line[] = [];
    for (const s of sprints) {
      out.push({ kind: "sprint", sprint: s });
      if (!isFolded(s)) out.push(...tasks(shown.filter((x) => x.sprintId === s.id)));
    }
    const rest = tasks(shown.filter((x) => !x.sprintId));
    if (rest.length) out.push({ kind: "backlog" }, ...rest);
    return out;
  });

  const range = $derived.by(() => {
    const spans: { start: string; end: string }[] = shown.map(spanOf).filter((s): s is Span => Boolean(s));
    const focus = sprints.find((s) => s.id === sprintId);
    if (focus) spans.push({ start: focus.startsOn, end: focus.endsOn });
    if (sprintId === "all") spans.push(...sprints.map((s) => ({ start: s.startsOn, end: s.endsOn })));
    return timelineRange(spans, today, focus ? 1 : 2);
  });
  const days = $derived(dayList(range.start, range.end));

  let width = $state(900);
  const narrow = $derived(width < 700);
  const labelW = $derived(narrow ? 130 : 220);
  const dayW = $derived(Math.min(48, Math.max(sprintId === "all" ? 10 : 24, Math.floor((width - labelW - 2) / Math.max(1, days.length)))));
  const trackW = $derived(days.length * dayW);
  const height = $derived(HEAD + lines.length * ROW);
  const xOf = (day: string) => daysBetween(range.start, day) * dayW;
  const yOf = (i: number) => HEAD + i * ROW;
  const canDrag = $derived(pipe.canManage && !pipe.archived && !narrow);

  const months = $derived(
    days.filter((d, i) => i === 0 || d.endsWith("-01")).map((d) => ({
      day: d, label: new Intl.DateTimeFormat(intlLocale(), { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)),
    }))
  );
  // Every day when they fit, else Mondays; none cut off at the right edge.
  const dayLabels = $derived((dayW >= 22 ? days : days.filter((d) => isoWeekday(d) === 1)).filter((d) => dayW >= 22 || xOf(d) + 56 <= trackW));

  const COLORS: Record<string, string> = { done: "var(--tl-done)", blocked: "var(--danger, #ed2651)", started: "var(--link)", ongoing: "var(--link)" };
  const colorOf = (task: Task) => COLORS[task.status] ?? "var(--text-tertiary)";
  const isRelease = (task: Task) => task.taskType === "release";

  // Arrows: from the end of the task waited for to the start of the one waiting.
  const rowOf = $derived(new Map(lines.flatMap((l, i) => (l.kind === "task" ? [[l.task.id, i] as const] : []))));
  const arrows = $derived(
    deps.flatMap((d) => {
      const a = rowOf.get(d.waitsFor);
      const b = rowOf.get(d.taskId);
      if (a === undefined || b === undefined) return [];
      const from = lines[a] as Extract<Line, { kind: "task" }>;
      const to = lines[b] as Extract<Line, { kind: "task" }>;
      const x1 = xOf(from.span.end) + dayW;
      const y1 = yOf(a) + ROW / 2;
      const x2 = xOf(to.span.start);
      const y2 = yOf(b) + ROW / 2;
      const late = to.span.start <= from.span.end;
      const path = x2 - x1 >= 12
        ? `M${x1},${y1}h6V${y2}H${x2 - 2}`
        : `M${x1},${y1}h6V${y2 - ROW / 2 * Math.sign(y2 - y1 || 1)}H${x2 - 8}V${y2}H${x2 - 2}`;
      return [{ key: `${d.waitsFor}-${d.taskId}`, path, late }];
    })
  );

  // ----- Dragging a bar
  let drag = $state<{ task: Task; edge: "move" | "start" | "end"; x: number; span: Span; delta: number } | null>(null);
  function onpointerdown(e: PointerEvent, task: Task, span: Span) {
    if (!canDrag || e.button !== 0) return;
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const edge = e.clientX - r.left < 6 && !isRelease(task) ? "start" : r.right - e.clientX < 6 ? "end" : "move";
    drag = { task, edge, x: e.clientX, span, delta: 0 };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function onpointermove(e: PointerEvent) {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.x) / dayW);
    if (delta === drag.delta) return;
    drag.delta = delta;
    moved[drag.task.id] = { ...shiftSpan(drag.span, isRelease(drag.task) ? "end" : drag.edge, delta), inferred: false };
  }
  async function onpointerup() {
    if (!drag) return;
    const { task, delta } = drag;
    drag = null;
    if (!delta) {
      delete moved[task.id];
      app.openTask(task.id);
      return;
    }
    const s = moved[task.id];
    try {
      await api.patch(`/tasks/${task.id}`, isRelease(task) ? { dueDate: s.end } : { startDate: s.start, dueDate: s.end });
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
    delete moved[task.id];
    app.refresh();
  }

  let hover = $state<{ task: Task; span: Span; x: number; y: number } | null>(null);
</script>

<div class="timeline">
  <div class="legend">
    <span><i style="background:var(--text-tertiary)"></i>{t("To do")}</span>
    <span><i style="background:var(--link)"></i>{t("In progress")}</span>
    <span><i style="background:var(--danger, #ed2651)"></i>{t("Blocked")}</span>
    <span><i style="background:var(--tl-done)"></i>{t("Done")}</span>
    <span><i class="inferred"></i>{t("Dates of the sprint")}</span>
    <span><i class="diamond"></i>{t("Release")}</span>
    {#if canDrag}<span class="muted">{t("Drag a bar to move it, its ends to change its dates.")}</span>{/if}
  </div>

  <div class="scroller" bind:clientWidth={width}>
    <div class="inner" style="width:{labelW + trackW}px">
      <div class="labels" style="width:{labelW}px">
        <div class="label-head" style="height:{HEAD}px"></div>
        {#each lines as line (line.kind === "task" ? line.task.id : line.kind === "sprint" ? line.sprint.id : "backlog")}
          {#if line.kind === "sprint"}
            <button class="label group" style="height:{ROW}px" aria-expanded={!isFolded(line.sprint)}
              onclick={() => (folded[line.sprint.id] = !isFolded(line.sprint))}>
              <span class="chev" class:open={!isFolded(line.sprint)}><Icon name="chevron" size={12} /></span>
              <strong>{line.sprint.name}</strong>
              {#if line.sprint.status === "active"}<span class="state">{t("Under way")}</span>{/if}
            </button>
          {:else if line.kind === "backlog"}
            <div class="label group" style="height:{ROW}px"><strong>{t("Backlog")}</strong></div>
          {:else}
            <button class="label task" class:done={line.task.status === "done"} style="height:{ROW}px" title={line.task.title}
              onclick={() => app.openTask(line.task.id)}>
              {#if line.task.points !== null}<span class="pts">{line.task.points}</span>{/if}
              <span class="title">{line.task.title}</span>
            </button>
          {/if}
        {/each}
      </div>

      <svg width={trackW} height={height} role="img" aria-label={t("Timeline of the pipe")}
        onpointermove={onpointermove} onpointerup={onpointerup} onpointercancel={() => { if (drag) delete moved[drag.task.id]; drag = null; }}>
        <defs>
          <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0L8,4L0,8Z" fill="context-stroke" />
          </marker>
        </defs>
        <!-- Days off, shaded; the scale on top. -->
        {#each days as d (d)}
          {#if !workDays.includes(isoWeekday(d))}<rect class="off" x={xOf(d)} y={HEAD} width={dayW} height={height - HEAD} />{/if}
        {/each}
        {#each months as m (m.day)}<text class="month" x={xOf(m.day) + 4} y="14">{m.label}</text>{/each}
        {#each dayLabels as d (d)}
          <text class="day" class:is-today={d === today} x={xOf(d) + (dayW >= 22 ? dayW / 2 : 2)} y="34" text-anchor={dayW >= 22 ? "middle" : "start"}>{dayW >= 22 ? Number(d.slice(8)) : formatDate(d)}</text>
        {/each}
        <line class="rule" x1="0" x2={trackW} y1={HEAD - 0.5} y2={HEAD - 0.5} />
        {#each lines as line, i (i)}
          <line class="row-rule" x1="0" x2={trackW} y1={yOf(i + 1) - 0.5} y2={yOf(i + 1) - 0.5} />
          {#if line.kind === "sprint"}
            <rect class="band" class:active={line.sprint.status === "active"} x={xOf(line.sprint.startsOn)} y={yOf(i) + ROW / 2 - 5}
              width={(daysBetween(line.sprint.startsOn, line.sprint.endsOn) + 1) * dayW} height="10" rx="3">
              <title>{line.sprint.name} · {formatDate(line.sprint.startsOn)} – {formatDate(line.sprint.endsOn)}</title>
            </rect>
          {:else if line.kind === "task"}
            {@const s = line.span}
            {@const x = xOf(s.start)}
            {@const w = (daysBetween(s.start, s.end) + 1) * dayW}
            {@const cy = yOf(i) + ROW / 2}
            {#if isRelease(line.task)}
              <line class="release-line" x1={xOf(s.end) + dayW / 2} x2={xOf(s.end) + dayW / 2} y1={HEAD} y2={height} />
              <path class="diamond" d="M{xOf(s.end) + dayW / 2},{cy - 7}l7,7l-7,7l-7,-7Z" style="fill:{colorOf(line.task)}" role="button" tabindex="0"
                aria-label={`${line.task.title}, ${formatDate(s.end)}`} class:grab={canDrag}
                onpointerdown={(e) => onpointerdown(e, line.task, s)} onkeydown={(e) => e.key === "Enter" && app.openTask(line.task.id)}
                onmouseenter={() => (hover = { task: line.task, span: s, x: xOf(s.end) + dayW / 2, y: cy })} onmouseleave={() => (hover = null)} />
            {:else}
              <rect class="bar" class:inferred={s.inferred} class:grab={canDrag} x={x + 1} y={cy - 7} width={Math.max(4, w - 2)} height="14" rx="4"
                style="--c:{colorOf(line.task)}" role="button" tabindex="0"
                aria-label={`${line.task.title}, ${formatDate(s.start)} – ${formatDate(s.end)}`}
                onpointerdown={(e) => onpointerdown(e, line.task, s)} onkeydown={(e) => e.key === "Enter" && app.openTask(line.task.id)}
                onmouseenter={() => (hover = { task: line.task, span: s, x: x + w / 2, y: cy })} onmouseleave={() => (hover = null)} />
            {/if}
          {/if}
        {/each}
        {#each arrows as a (a.key)}<path class="arrow" class:late={a.late} d={a.path} marker-end="url(#tl-arrow)" />{/each}
        {#if today >= range.start && today <= range.end}
          <line class="today" x1={xOf(today) + dayW / 2} x2={xOf(today) + dayW / 2} y1={HEAD} y2={height}><title>{t("Today")}</title></line>
          <path class="today-mark" d="M{xOf(today) + dayW / 2 - 4},{HEAD - 5}h8l-4,5Z" />
        {/if}
      </svg>

      {#if hover && !drag}
        {@const h = hover}
        <!-- Above the bars of the lower half, so that the frame does not cut it. -->
        <div class="tooltip" style="left:{labelW + h.x}px;top:{h.y > height / 2 ? h.y - 12 : h.y + 12}px;transform:translate({h.x < trackW * 0.25 ? '0' : h.x > trackW * 0.75 ? '-100%' : '-50%'}, {h.y > height / 2 ? '-100%' : '0'})">
          <strong>{h.task.title}</strong>
          <div>{formatDate(h.span.start)} – {formatDate(h.span.end)}{#if h.span.inferred}<span class="muted">{" · "}{t("dates of the sprint")}</span>{/if}</div>
          <div class="muted">{app.columnsFor(pipe.kind).find((c) => c.id === h.task.stage)?.label}{#if h.task.points !== null}{" · "}{t("{n} pts", { n: h.task.points })}{/if}{#if h.task.assignee}{" · "}{h.task.assignee.name}{/if}</div>
        </div>
      {/if}
    </div>
  </div>
  {#if undated}<p class="muted small">{tn(undated, "{n} task with no date and no sprint is not on the timeline.", "{n} tasks with no date and no sprint are not on the timeline.")}</p>{/if}
  {#if !lines.length}<p class="muted">{t("No task to show here yet: give tasks a sprint or dates.")}</p>{/if}
</div>

<style>
  .timeline { --tl-done: #2a9d63; display: flex; flex-direction: column; gap: 8px; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--text-secondary); align-items: center; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend i { display: inline-block; width: 14px; height: 8px; border-radius: 3px; }
  .legend i.inferred { border: 1.5px dashed var(--link); background: color-mix(in srgb, var(--link) 35%, transparent); }
  .legend i.diamond { width: 9px; height: 9px; border-radius: 1px; transform: rotate(45deg); background: var(--text-tertiary); }
  .scroller { overflow-x: auto; border: 1px solid var(--divider); border-radius: 10px; background: var(--background); }
  .inner { position: relative; display: flex; }
  .labels { position: sticky; left: 0; z-index: 2; background: var(--background); border-right: 1px solid var(--divider); flex-shrink: 0; }
  .label-head { border-bottom: 1px solid var(--divider); }
  .label {
    display: flex; align-items: center; gap: 6px; width: 100%; padding: 0 10px; border: 0; border-bottom: 1px solid var(--divider);
    background: none; font: inherit; font-size: 13px; color: var(--text); text-align: left; cursor: pointer; box-sizing: border-box; min-width: 0;
  }
  .label.group { background: var(--background-secondary); font-size: 13px; }
  .label.task:hover { background: var(--list-hover); }
  .label.task.done .title { color: var(--text-tertiary); text-decoration: line-through; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .pts { font-size: 11px; font-weight: 600; min-width: 18px; text-align: center; border-radius: 9px; background: var(--background-tertiary); color: var(--text-secondary); flex-shrink: 0; }
  .chev { display: inline-flex; transition: transform 0.15s; color: var(--text-tertiary); }
  .chev.open { transform: rotate(90deg); }
  .state { font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 8px; background: #9e5cf7; color: #fff; }
  svg { display: block; flex-shrink: 0; touch-action: pan-x pan-y; }
  .off { fill: var(--background-secondary); }
  .month { font-size: 11px; font-weight: 600; fill: var(--text-secondary); text-transform: capitalize; }
  .day { font-size: 11px; fill: var(--text-tertiary); font-variant-numeric: tabular-nums; }
  .rule, .row-rule { stroke: var(--divider); }
  .band { fill: var(--background-tertiary); }
  .band.active { fill: color-mix(in srgb, #9e5cf7 45%, transparent); }
  .bar { fill: var(--c); cursor: pointer; }
  .bar.inferred { fill: color-mix(in srgb, var(--c) 35%, transparent); stroke: var(--c); stroke-width: 1.5; stroke-dasharray: 4 3; }
  .bar:focus-visible, .diamond:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .grab { cursor: grab; }
  .diamond { cursor: pointer; stroke: var(--background); stroke-width: 2; }
  .release-line { stroke: var(--text-tertiary); stroke-dasharray: 2 4; opacity: 0.6; }
  .arrow { fill: none; stroke: var(--text-tertiary); stroke-width: 1.5; }
  .arrow.late { stroke: var(--danger, #ed2651); }
  .today { stroke: var(--danger, #ed2651); stroke-width: 1.5; }
  .today-mark { fill: var(--danger, #ed2651); }
  .day.is-today { fill: var(--danger, #ed2651); font-weight: 700; }
  .tooltip {
    position: absolute; z-index: 3; pointer-events: none; background: var(--modal-background, var(--background)); box-shadow: var(--menu-shadow);
    border-radius: 8px; padding: 6px 10px; font-size: 12px; max-width: 280px; display: flex; flex-direction: column; gap: 2px;
  }
</style>
