<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { dueState, localDay } from "../lib/constants";
  import { addDays, addMonths, dayTitle, monthGrid, monthTitle, weekOf, weekdayShort } from "../lib/calendar";
  import type { Task } from "../lib/types";
  import Icon from "../components/Icon.svelte";
  import TaskBadges from "../components/TaskBadges.svelte";
  import { t } from "../lib/i18n.svelte";

  type CalendarTask = Task & { canMove: boolean };
  /** Tasks shown in a day of the month view; the others behind "n more". */
  const MONTH_CELL = 4;

  const read = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const keep = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* storage unavailable */ } };

  let view = $state<"month" | "week">(read("tp:calendarView", "month") === "week" ? "week" : "month");
  let anchor = $state(localDay());
  let scope = $state<"mine" | "all">(read("tp:calendarScope", "mine") === "all" ? "all" : "mine");
  let spaceId = $state("");
  let showDone = $state(false);
  let tasks = $state<CalendarTask[]>([]);
  let truncated = $state(false);
  let error = $state("");
  let draggedId = $state<string | null>(null);
  let overDay = $state<string | null>(null);

  const today = localDay();
  const weeks = $derived(view === "month" ? monthGrid(anchor) : [weekOf(anchor)]);
  const from = $derived(weeks[0][0]);
  const to = $derived(weeks.at(-1)!.at(-1)!);
  const title = $derived(view === "month" ? monthTitle(anchor) : `${dayTitle(from)} – ${dayTitle(to)}`);
  const byDay = $derived.by(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const task of tasks) map.set(task.dueDate!, [...(map.get(task.dueDate!) ?? []), task]);
    return map;
  });

  // Reloaded when the period or a filter changes, and after any change elsewhere.
  let seq = 0;
  $effect(() => {
    app.version;
    const params = new URLSearchParams({ from, to, scope, ...(spaceId ? { space: spaceId } : {}), ...(showDone ? { done: "1" } : {}) });
    const n = ++seq;
    api.get<{ tasks: CalendarTask[]; truncated: boolean }>(`/calendar?${params}`)
      .then((r) => { if (n === seq) { tasks = r.tasks; truncated = r.truncated; error = ""; } })
      .catch((err) => { if (n === seq) error = errorMessage(err); });
  });

  function setView(v: "month" | "week") {
    view = v;
    keep("tp:calendarView", v);
  }
  function setScope(v: "mine" | "all") {
    scope = v;
    keep("tp:calendarScope", v);
  }
  const move = (n: number) => (anchor = view === "month" ? addMonths(anchor, n) : addDays(anchor, 7 * n));

  /** Moves a task to another day: its due date changes (the server checks one may). */
  async function dropOn(day: string) {
    const task = tasks.find((x) => x.id === draggedId);
    draggedId = null;
    overDay = null;
    if (!task || task.dueDate === day) return;
    const before = task.dueDate;
    tasks = tasks.map((x) => (x.id === task.id ? { ...x, dueDate: day } : x));
    try {
      await api.patch(`/tasks/${task.id}`, { dueDate: day });
      app.toast(t("Due date moved"));
    } catch (err) {
      tasks = tasks.map((x) => (x.id === task.id ? { ...x, dueDate: before } : x));
      app.toast(errorMessage(err), "error");
    }
  }
</script>

<div class="page wide">
  <div class="page-header">
    <div class="grow">
      <h1><Icon name="calendar" size={26} />{t("Calendar")}</h1>
      <div class="subtitle">{t("Tasks by due date, in the pipes you see. Drag a task to another day to change its due date.")}</div>
    </div>
  </div>

  <div class="toolbar">
    <div class="row">
      <button class="btn neutral icon" title={t("Previous period")} aria-label={t("Previous period")} onclick={() => move(-1)}><Icon name="chevron" size={16} /></button>
      <button class="btn neutral" onclick={() => (anchor = localDay())}>{t("Today")}</button>
      <button class="btn neutral icon" title={t("Next period")} aria-label={t("Next period")} onclick={() => move(1)}><Icon name="chevron" size={16} /></button>
      <h2 class="period">{title}</h2>
    </div>
    <div class="row wrap">
      <div class="seg" role="group" aria-label={t("View")}>
        <button class:active={view === "month"} onclick={() => setView("month")}>{t("Month")}</button>
        <button class:active={view === "week"} onclick={() => setView("week")}>{t("Week")}</button>
      </div>
      <div class="seg" role="group" aria-label={t("Tasks")}>
        <button class:active={scope === "mine"} onclick={() => setScope("mine")}>{t("My tasks")}</button>
        <button class:active={scope === "all"} onclick={() => setScope("all")}>{t("Everything I see")}</button>
      </div>
      <select class="input narrow" bind:value={spaceId} aria-label={t("Space")}>
        <option value="">{t("All spaces")}</option>
        {#each app.spaces.filter((s) => s.myRole || s.kind === "team") as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
      </select>
      <label class="check"><input type="checkbox" bind:checked={showDone} />{t("Show finished tasks")}</label>
    </div>
  </div>

  {#if error}<div class="callout danger">{error}</div>{/if}
  {#if truncated}<div class="callout warning">{t("Too many tasks in this period: only the first ones are shown. Narrow the filters.")}</div>{/if}

  <div class="grid" class:week={view === "week"} role="grid" aria-label={title}>
    <div class="head" role="row">
      {#each weeks[0] as day (day)}<div class="weekday" role="columnheader">{weekdayShort(day)}</div>{/each}
    </div>
    {#each weeks as week (week[0])}
      <div class="week-row" role="row">
        {#each week as day (day)}
          {@const list = byDay.get(day) ?? []}
          {@const shown = view === "month" ? list.slice(0, MONTH_CELL) : list}
          <div class="day" role="gridcell" tabindex="-1" data-day={day} class:other={view === "month" && day.slice(0, 7) !== anchor.slice(0, 7)}
            class:today={day === today} class:over={overDay === day}
            ondragover={(e) => { if (draggedId) { e.preventDefault(); overDay = day; } }}
            ondragleave={() => overDay === day && (overDay = null)}
            ondrop={(e) => { e.preventDefault(); dropOn(day); }}>
            <div class="num">{view === "week" ? dayTitle(day) : Number(day.slice(8))}</div>
            {#each shown as task (task.id)}
              <button class="item {dueState(task.dueDate, task.status)}" class:done={task.status === "done" || task.status === "abandoned"}
                draggable={task.canMove} data-task={task.id} title={`#${task.number} ${task.title} · ${task.space.name}${task.pipe ? ` › ${task.pipe.name}` : ""}`}
                ondragstart={(e) => { draggedId = task.id; e.dataTransfer?.setData("text/plain", task.id); }}
                ondragend={() => { draggedId = null; overDay = null; }}
                onclick={() => app.openTask(task.id)}>
                <TaskBadges priority={task.priority} />
                <span class="item-title">{task.title}</span>
              </button>
            {/each}
            {#if list.length > shown.length}
              <button class="more" onclick={() => { anchor = day; setView("week"); }}>{t("+{n} more", { n: list.length - shown.length })}</button>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .toolbar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
  .period { font-size: 18px; margin: 0 0 0 8px; text-transform: capitalize; }
  .toolbar .btn.icon:first-child :global(svg) { transform: rotate(180deg); }
  .seg { display: inline-flex; border: 1px solid var(--input-border); border-radius: 6px; overflow: hidden; }
  .seg button { border: 0; background: none; color: var(--text-secondary); font: inherit; font-size: 13px; padding: 6px 12px; cursor: pointer; }
  .seg button.active { background: var(--background-secondary); color: var(--text); font-weight: 500; }
  .narrow { width: auto; min-height: 32px; padding: 2px 8px; font-size: 14px; }
  .check { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; }
  .grid { border: 1px solid var(--divider); border-radius: 8px; overflow: hidden; }
  .head, .week-row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
  .weekday { padding: 6px 8px; font-size: 12px; text-transform: uppercase; color: var(--text-tertiary); background: var(--background-secondary); }
  .day { min-height: 110px; border-top: 1px solid var(--divider); border-left: 1px solid var(--divider); padding: 4px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .week .day { min-height: 320px; }
  .week-row .day:first-child { border-left: 0; }
  .day.other { background: var(--background-secondary); }
  .day.other .num { color: var(--text-tertiary); }
  .day.today .num { color: var(--accent, #0366d6); font-weight: 700; }
  .day.over { box-shadow: inset 0 0 0 2px var(--accent, #0366d6); }
  .num { font-size: 12px; color: var(--text-secondary); padding: 0 2px; }
  .item {
    display: flex; align-items: center; gap: 4px; width: 100%; text-align: left; font: inherit; font-size: 12px;
    background: var(--card-background); box-shadow: var(--card-shadow); border: 0; border-radius: 4px; padding: 2px 6px;
    color: var(--text); cursor: pointer;
  }
  .item[draggable="true"] { cursor: grab; }
  .item.overdue { box-shadow: inset 3px 0 0 var(--danger, #ed2651), var(--card-shadow); }
  .item.done .item-title { text-decoration: line-through; color: var(--text-tertiary); }
  .item-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .more { border: 0; background: none; font: inherit; font-size: 12px; color: var(--text-secondary); text-align: left; cursor: pointer; padding: 0 2px; }
  @media (max-width: 700px) {
    .day { min-height: 70px; }
    .item-title { display: none; }
  }
</style>
