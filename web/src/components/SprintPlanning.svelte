<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { formatDate } from "../lib/constants";
  import { t, tn } from "../lib/i18n.svelte";
  import { POINTS, pointsText } from "../lib/labels";
  import { capacity, openSprints, sprintStats } from "../lib/sprints";
  import type { PipeDetail, Sprint, Task } from "../lib/types";
  import Icon, { iconOf } from "./Icon.svelte";
  import SprintModal from "./SprintModal.svelte";
  import CloseSprintModal from "./CloseSprintModal.svelte";
  import SprintProgressModal from "./SprintProgressModal.svelte";

  /** Planning of a pipe in sprints: its backlog beside the sprints still open; tasks go from one to another. */
  let { pipe }: { pipe: PipeDetail } = $props();

  const sprints = $derived(openSprints(pipe.sprints ?? []));
  const cap = $derived(capacity(pipe));
  const open = (x: Task) => x.status !== "done" && x.status !== "abandoned";
  // The backlog: unfinished tasks in no sprint (a task of a closed sprint stays there).
  const backlog = $derived(pipe.tasks.filter((x) => !x.sprintId && open(x)));
  const inSprint = (id: string) => pipe.tasks.filter((x) => x.sprintId === id && x.status !== "abandoned");
  const canPlan = $derived(pipe.canManage && !pipe.archived);

  let editing = $state<Sprint | "new" | null>(null);
  let closing = $state<Sprint | null>(null);
  let progress = $state(false);
  let dragged = $state<string | null>(null);
  let over = $state<string | null>(null);

  async function moveTo(task: Task, sprintId: string | null) {
    if ((task.sprintId ?? null) === sprintId) return;
    task.sprintId = sprintId;
    try {
      await api.patch(`/tasks/${task.id}`, { sprintId });
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
    app.refresh();
  }

  async function setPoints(task: Task, points: number | null) {
    task.points = points;
    try {
      await api.patch(`/tasks/${task.id}`, { points });
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
    app.refresh();
  }

  async function act(s: Sprint, action: "start" | "delete") {
    if (action === "delete" && !confirm(t("Delete {name}? Its tasks go back to the backlog.", { name: s.name }))) return;
    try {
      if (action === "start") await api.post(`/sprints/${s.id}/start`);
      else await api.del(`/sprints/${s.id}`);
      app.refresh();
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
  }

  function ondrop(e: DragEvent, sprintId: string | null) {
    e.preventDefault();
    const task = pipe.tasks.find((x) => x.id === dragged);
    dragged = over = null;
    if (task) moveTo(task, sprintId);
  }
  const dropZone = (key: string) => ({
    ondragover: (e: DragEvent) => { if (dragged) { e.preventDefault(); over = key; } },
    ondragleave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) over = null; },
  });
</script>

{#snippet row(task: Task)}
  {@const type = task.taskType !== "task" ? app.taskType(task.taskType) : undefined}
  <li class="plan-row" class:done={task.status === "done"} class:dragging={dragged === task.id} draggable={canPlan}
    ondragstart={(e) => { e.dataTransfer?.setData("text/plain", task.id); dragged = task.id; }} ondragend={() => (dragged = over = null)}>
    {#if canPlan}<span class="grip" aria-hidden="true"><Icon name="grip" size={14} /></span>{/if}
    {#if type}<span class="type" title={type.label}><Icon name={iconOf(type.icon)} size={14} /></span>{/if}
    <button class="title link-button" onclick={() => app.openTask(task.id)}>{task.title}</button>
    {#if canPlan}
      <select class="input mini" value={task.points ?? ""} aria-label={t("Points of {title}", { title: task.title })}
        onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; setPoints(task, v === "" ? null : Number(v)); }}>
        <option value="">–</option>
        {#each POINTS as n (n)}<option value={n}>{n}</option>{/each}
      </select>
      <select class="input mini sprint-pick" value={task.sprintId ?? ""} aria-label={t("Sprint of {title}", { title: task.title })}
        onchange={(e) => moveTo(task, (e.currentTarget as HTMLSelectElement).value || null)}>
        <option value="">{t("Backlog")}</option>
        {#each sprints as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
      </select>
    {:else if task.points !== null}
      <span class="pts" title={pointsText(task.points)}>{task.points}</span>
    {/if}
  </li>
{/snippet}

<div class="plan-head">
  <span><Icon name="target" size={16} />{t("Velocity")}
    <strong>{cap === null ? "–" : t("{n} pts", { n: cap })}</strong>
    <span class="muted">{pipe.velocity?.source === "learned" ? t("learned from the last sprints") : pipe.velocity?.source === "manual" ? t("set by hand") : t("the initial one, until three sprints count")}</span>
  </span>
  <button class="btn small neutral" onclick={() => (progress = true)}><Icon name="chart" size={14} />{t("Progress of the work")}</button>
</div>

<div class="planning">
  <section class="plan-col" class:over={over === "backlog"} aria-label={t("Backlog")} {...dropZone("backlog")} ondrop={(e) => ondrop(e, null)}>
    <header>
      <div class="line"><strong>{t("Backlog")}</strong><span class="count neutral">{backlog.length}</span>
        <span class="spacer"></span><span class="muted">{t("{n} pts", { n: sprintStats(backlog, null).points })}</span></div>
      <div class="muted small">{t("Tasks in no sprint, by order of the board")}</div>
    </header>
    <ul>{#each backlog as task (task.id)}{@render row(task)}{/each}</ul>
    {#if !backlog.length}<p class="muted small empty">{t("Nothing left to plan.")}</p>{/if}
  </section>

  {#each sprints as s (s.id)}
    {@const tasks = inSprint(s.id)}
    {@const stats = sprintStats(pipe.tasks, s.id)}
    <section class="plan-col" class:over={over === s.id} class:active={s.status === "active"} aria-label={s.name} {...dropZone(s.id)} ondrop={(e) => ondrop(e, s.id)}>
      <header>
        <div class="line">
          <strong>{s.name}</strong>
          {#if s.status === "active"}<span class="state">{t("Under way")}</span>{/if}
          <span class="spacer"></span>
          <span class="load" class:full={cap !== null && stats.points > cap}
            title={cap !== null ? t("Points planned against the velocity") : t("Points planned")}>
            {cap !== null ? t("{done} / {total} pts", { done: stats.points, total: cap }) : t("{n} pts", { n: stats.points })}
          </span>
        </div>
        <div class="muted small">{formatDate(s.startsOn)} – {formatDate(s.endsOn)} · {tn(tasks.length, "{n} task", "{n} tasks")}
          {#if stats.unestimated} · {tn(stats.unestimated, "{n} without points", "{n} without points")}{/if}</div>
        {#if cap !== null}
          <div class="gauge" aria-hidden="true"><span class:full={stats.points > cap} style="width:{Math.min(100, cap ? (stats.points / cap) * 100 : 100)}%"></span></div>
        {/if}
        {#if s.goal}<div class="goal small"><Icon name="flag" size={12} />{s.goal}</div>{/if}
        {#if canPlan}
          <div class="actions">
            {#if s.status === "planned"}
              <button class="btn small neutral" disabled={sprints.some((x) => x.status === "active")} onclick={() => act(s, "start")}
                title={sprints.some((x) => x.status === "active") ? t("Close the sprint under way first") : undefined}><Icon name="play" size={14} />{t("Start the sprint")}</button>
            {:else}
              <button class="btn small neutral" onclick={() => (closing = s)}><Icon name="check" size={14} />{t("Close the sprint")}</button>
            {/if}
            <button class="btn small ghost icon" title={t("Edit the sprint")} aria-label={t("Edit the sprint")} onclick={() => (editing = s)}><Icon name="edit" size={14} /></button>
            {#if s.status === "planned"}
              <button class="btn small ghost icon" title={t("Delete the sprint")} aria-label={t("Delete the sprint")} onclick={() => act(s, "delete")}><Icon name="trash" size={14} /></button>
            {/if}
          </div>
        {/if}
      </header>
      <ul>{#each tasks as task (task.id)}{@render row(task)}{/each}</ul>
      {#if !tasks.length}<p class="muted small empty">{canPlan ? t("Drop tasks here, or choose this sprint on them.") : t("No task yet.")}</p>{/if}
    </section>
  {/each}

  {#if canPlan}
    <button class="plan-col add-col" onclick={() => (editing = "new")}><Icon name="plus" size={18} />{t("New sprint")}</button>
  {/if}
</div>

{#if editing}<SprintModal pipeId={pipe.id} sprint={editing === "new" ? null : editing} onclose={() => (editing = null)} />{/if}
{#if progress}<SprintProgressModal pipeId={pipe.id} weeks={pipe.sprintSettings?.weeks ?? 2} onclose={() => (progress = false)} />{/if}
{#if closing}
  <CloseSprintModal sprint={closing} tasks={pipe.tasks} next={sprints.find((x) => x.status === "planned") ?? null} onclose={() => (closing = null)} />
{/if}

<style>
  .plan-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; font-size: 14px; }
  .plan-head > span { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .planning { display: flex; gap: 12px; align-items: flex-start; overflow-x: auto; padding-bottom: 12px; }
  .plan-col {
    flex: 0 0 340px; max-width: 86vw; background: var(--background-secondary); border-radius: 10px; padding: 10px;
    display: flex; flex-direction: column; gap: 8px; min-height: 120px; border: 2px solid transparent;
  }
  .plan-col.active { border-color: #9e5cf7; }
  .plan-col.over { border-color: var(--accent); border-style: dashed; }
  header { display: flex; flex-direction: column; gap: 4px; }
  .line { display: flex; align-items: center; gap: 8px; font-size: 14px; }
  .state { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 9px; background: #9e5cf7; color: #fff; }
  .load { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .load.full, .gauge .full { color: var(--danger, #ed2651); }
  .gauge { height: 6px; border-radius: 3px; background: var(--background-tertiary); overflow: hidden; }
  .gauge span { display: block; height: 100%; background: #2a9d63; }
  .gauge span.full { background: var(--danger, #ed2651); }
  .goal { display: flex; gap: 6px; align-items: baseline; color: var(--text-secondary); }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .plan-row {
    display: flex; align-items: center; gap: 6px; background: var(--card-background); border-radius: 6px; box-shadow: var(--card-shadow);
    padding: 5px 6px; font-size: 13px;
  }
  .plan-row.dragging { opacity: 0.4; }
  .plan-row.done .title { text-decoration: line-through; color: var(--text-tertiary); }
  .grip { color: var(--text-tertiary); cursor: grab; display: inline-flex; }
  .type { color: var(--text-tertiary); display: inline-flex; }
  .title { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .link-button { background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; }
  .link-button:hover { text-decoration: underline; }
  .mini { width: auto; padding: 2px 4px; font-size: 12px; height: 26px; flex-shrink: 0; }
  .sprint-pick { max-width: 110px; }
  .pts { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
  .empty { margin: 4px 2px; }
  .add-col {
    flex: 0 0 200px; align-items: center; justify-content: center; flex-direction: row; cursor: pointer; font: inherit; font-size: 14px;
    color: var(--text-secondary); border: 2px dashed var(--divider);
  }
  .add-col:hover { color: var(--text); border-color: var(--input-border-focused); }
</style>
