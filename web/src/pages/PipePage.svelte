<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { openTaskCount } from "../lib/constants";
  import type { PipeDetail, Task } from "../lib/types";
  import SpaceIcon from "../components/SpaceIcon.svelte";
  import Icon from "../components/Icon.svelte";
  import Markdown from "../components/Markdown.svelte";
  import TaskCard from "../components/TaskCard.svelte";
  import PipeModal from "../components/PipeModal.svelte";
  import ReportModal from "../components/ReportModal.svelte";
  import IconPicker from "../components/IconPicker.svelte";
  import NewTaskModal from "../components/NewTaskModal.svelte";
  import TransferModal from "../components/TransferModal.svelte";
  import WebhooksModal from "../components/WebhooksModal.svelte";
  import { confirmWhileBlocked } from "../lib/dependencies";
  import { PRIORITIES, distinctLabels, matches, type TaskFilters } from "../lib/labels";
  import { boardLanes, loadLabel, overLimit } from "../lib/lanes";

  let { id }: { id: string } = $props();

  let pipe = $state<PipeDetail | null>(null);
  let error = $state("");
  let editing = $state(false);
  let reports = $state(false);
  let transfer = $state(false);
  let webhooks = $state(false);
  /** Column in which to create a task ("" = the first one). */
  let newTaskStage = $state<string | null>(null);
  let filter = $state("");
  let mineOnly = $state(false);
  // Filters by label, priority, owner and type, chosen among what the pipe's tasks have.
  let labelFilter = $state("");
  let priorityFilter = $state("");
  let ownerFilter = $state("");
  let typeFilter = $state("");
  const filters = $derived<TaskFilters>({
    labels: labelFilter ? [labelFilter] : [],
    priority: priorityFilter === "" ? undefined : (Number(priorityFilter) as TaskFilters["priority"]),
    owner: ownerFilter || undefined,
    type: typeFilter || undefined,
  });
  const labelChoices = $derived(distinctLabels((pipe?.tasks ?? []).flatMap((x) => x.labels)));
  const ownerChoices = $derived(
    [...new Map((pipe?.tasks ?? []).filter((x) => x.assignee).map((x) => [x.assignee!.id, x.assignee!])).values()].sort((a, b) => a.name.localeCompare(b.name))
  );
  const typeChoices = $derived(app.taskTypesFor(pipe?.kind).filter((tt) => (pipe?.tasks ?? []).some((x) => x.taskType === tt.id)));

  // Drag & drop state
  let draggedId = $state<string | null>(null);
  let drop = $state<{ stage: string; lane: string; index: number } | null>(null);

  // Swimlanes: one row of columns per owner (team pipes) or per task type; remembered in the browser.
  type LanesBy = "none" | "owner" | "type";
  const readLanes = (): LanesBy => {
    try {
      const v = localStorage.getItem("tp:pipeLanes");
      return v === "owner" || v === "type" ? v : "none";
    } catch {
      return "none";
    }
  };
  let lanesBy = $state<LanesBy>(readLanes());
  function setLanes(v: LanesBy) {
    lanesBy = v;
    try { localStorage.setItem("tp:pipeLanes", v); } catch { /* storage unavailable */ }
  }

  $effect(() => {
    app.version;
    api.get<PipeDetail>(`/pipes/${id}`).then((p) => (pipe = p)).catch((err) => (error = errorMessage(err)));
  });

  const visible = $derived(
    (pipe?.tasks ?? []).filter(
      (x) =>
        (!filter.trim() || x.title.toLowerCase().includes(filter.trim().toLowerCase())) &&
        (!mineOnly || x.assignee?.id === app.me?.user.id) &&
        matches(x, filters)
    )
  );
  const boardColumns = $derived(app.columnsFor(pipe?.kind));
  const lanes = $derived(boardLanes(visible, pipe?.space.kind === "team" ? lanesBy : lanesBy === "owner" ? "none" : lanesBy));
  // Tasks per lane and column.
  const cells = $derived(
    Object.fromEntries(lanes.map((l) => [l.id, Object.fromEntries(boardColumns.map((c) => [c.id, visible.filter((x) => x.stage === c.id && l.has(x))]))])) as
      Record<string, Record<string, Task[]>>
  );
  // A column's load counts all its tasks, whatever the filters.
  const load = (stage: string) => (pipe?.tasks ?? []).filter((x) => x.stage === stage).length;

  function ondragover(e: DragEvent, stage: string, lane: string) {
    if (!draggedId) return;
    e.preventDefault();
    const body = e.currentTarget as HTMLElement;
    const cards = [...body.querySelectorAll<HTMLElement>("[data-task-card]")].filter((c) => c.dataset.taskCard !== draggedId);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    drop = { stage, lane, index };
  }

  // Every task done or abandoned: the pipe can be closed.
  const finished = $derived(Boolean(pipe?.tasks.length) && openTaskCount(pipe!.counts) === 0);

  async function save(body: Record<string, unknown>) {
    if (!pipe) return;
    Object.assign(pipe, body);
    try {
      await api.patch(`/pipes/${pipe.id}`, body);
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
    app.refresh();
  }

  // Inline title, like an Outline document: saved on blur or Enter, Escape cancels.
  function rename(e: FocusEvent) {
    const input = e.currentTarget as HTMLInputElement;
    const name = input.value.trim();
    if (!pipe || !name || name === pipe.name) {
      input.value = pipe?.name ?? "";
      return;
    }
    save({ name });
  }

  function titleKeydown(e: KeyboardEvent) {
    const input = e.currentTarget as HTMLInputElement;
    if (e.key === "Escape") input.value = pipe?.name ?? "";
    if (e.key === "Enter" || e.key === "Escape") input.blur();
  }

  async function setArchived(archived: boolean) {
    try {
      await api.patch(`/pipes/${id}`, { archived });
      app.toast(archived ? t("Pipe archived") : t("Pipe unarchived"));
      app.refresh();
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
  }

  async function ondrop(e: DragEvent) {
    e.preventDefault();
    if (!pipe || !draggedId || !drop) return;
    const task = pipe.tasks.find((x) => x.id === draggedId)!;
    const siblings = cells[drop.lane][drop.stage].filter((x) => x.id !== draggedId);
    // Dropped in another lane: its owner or type changes too.
    const lane = lanes.find((l) => l.id === drop!.lane)!;
    const change = lane.has(task) ? null : lane.change;
    const prev = siblings[drop.index - 1];
    const next = siblings[drop.index];
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next ? next.position - 1 : 1;
    const { stage } = drop;
    draggedId = null;
    drop = null;
    if (task.stage === stage && task.position === position && !change) return;
    if (!confirmWhileBlocked(task, app.columnsFor(pipe.kind).find((c) => c.id === stage)?.status)) return;
    // Optimistic update, then reconcile with the server.
    pipe.tasks = pipe.tasks.map((x) => (x.id === task.id ? { ...x, stage, position } : x)).sort((a, b) => a.position - b.position);
    try {
      if (task.stage !== stage || task.position !== position) await api.post(`/tasks/${task.id}/move`, { pipeId: pipe.id, stage, position });
      if (change) await api.patch(`/tasks/${task.id}`, change);
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
    app.refresh();
  }
</script>

{#if error}
  <div class="page"><div class="callout danger">{error}</div></div>
{:else if pipe}
  <div class="page wide">
    <div class="page-header">
      <div class="grow">
        <div class="breadcrumb">
          <a href={`/spaces/${pipe.space.id}`}><SpaceIcon space={pipe.space} size={16} />{pipe.space.id === app.me?.personalSpaceId ? t("My space") : pipe.space.name}</a>
          <span>›</span><span>{t("Pipe")}</span>
        </div>
        <h1>
          <IconPicker icon={pipe.icon} color={pipe.color} kind={pipe.kind} editable={pipe.canManage} size={28}
            onchange={(next) => save(next)} />
          {#if pipe.canManage}
            <input class="title-input" value={pipe.name} maxlength="120" aria-label={t("Pipe name")} onblur={rename} onkeydown={titleKeydown} />
          {:else}
            {pipe.name}
          {/if}
          {#if pipe.archived}<span class="badge"><Icon name="archive" size={12} />{t("Archived")}</span>{/if}
          {#if app.pipeType(pipe.kind)}<span class="badge">{app.pipeType(pipe.kind)?.label}</span>{/if}
          {#if pipe.visibility === "open"}
            <span class="badge open"><Icon name="globe" size={12} />{t("Open")}</span>
          {:else}
            <span class="badge">{#if pipe.space.kind === "team"}<Icon name="users" size={12} />{t("Team")}{:else}<Icon name="lock" size={12} />{t("Personal")}{/if}</span>
          {/if}
        </h1>
        {#if pipe.description}<div class="description"><Markdown source={pipe.description} compact /></div>{/if}
        {#if pipe.archived}
          <div class="callout row archived">
            <Icon name="archive" />
            <span class="grow">{t("This pipe is archived: it no longer shows in lists and takes no new tasks.")}</span>
            {#if pipe.canManage}<button class="btn small neutral" onclick={() => setArchived(false)}>{t("Unarchive")}</button>{/if}
          </div>
        {/if}
        {#if finished && !pipe.archived && !pipe.isDefault && pipe.canManage}
          <div class="callout row archived">
            <Icon name="check" />
            <span class="grow">{t("All the tasks of this pipe are done or dropped.")}</span>
            <button class="btn small" onclick={() => setArchived(true)}><Icon name="archive" size={16} />{t("Archive the pipe")}</button>
          </div>
        {/if}
        {#if !pipe.canManage}
          <div class="subtitle">{t("Open pipe of {name}: you can add tasks and comment; only its members move them forward.", { name: pipe.space.name })}</div>
        {/if}
      </div>
      <div class="row wrap">
        <input class="input filter" placeholder={t("Filter…")} bind:value={filter} />
        {#if labelChoices.length}
          <select class="input filter-select" bind:value={labelFilter} aria-label={t("Label")}>
            <option value="">{t("Any label")}</option>
            {#each labelChoices as l (l.name)}<option value={l.name}>{l.name}</option>{/each}
          </select>
        {/if}
        <select class="input filter-select" bind:value={priorityFilter} aria-label={t("Priority")}>
          <option value="">{t("Any priority")}</option>
          {#each PRIORITIES as p (p.value)}<option value={String(p.value)}>{t(p.label)}</option>{/each}
          <option value="0">{t("No priority")}</option>
        </select>
        {#if pipe.space.kind === "team" && ownerChoices.length}
          <select class="input filter-select" bind:value={ownerFilter} aria-label={t("Owner")}>
            <option value="">{t("Any owner")}</option>
            {#each ownerChoices as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
            <option value="none">{t("Unassigned")}</option>
          </select>
        {/if}
        {#if typeChoices.length > 1}
          <select class="input filter-select" bind:value={typeFilter} aria-label={t("Task type")}>
            <option value="">{t("Any task type")}</option>
            {#each typeChoices as tt (tt.id)}<option value={tt.id}>{tt.label}</option>{/each}
          </select>
        {/if}
        {#if pipe.space.kind === "team"}
          <button class="btn neutral" class:active-toggle={mineOnly} onclick={() => (mineOnly = !mineOnly)}>
            <Icon name="user" size={16} />{t("Mine")}
          </button>
        {/if}
        <select class="input filter-select" value={lanesBy} aria-label={t("Swimlanes")} onchange={(e) => setLanes((e.currentTarget as HTMLSelectElement).value as LanesBy)}>
          <option value="none">{t("No swimlanes")}</option>
          {#if pipe.space.kind === "team"}<option value="owner">{t("Swimlanes by owner")}</option>{/if}
          <option value="type">{t("Swimlanes by task type")}</option>
        </select>
        <button class="btn neutral icon" class:active-toggle={app.isPinned(pipe.id)}
          title={app.isPinned(pipe.id) ? t("Unpin from the menu") : t("Pin to the menu")}
          onclick={() => app.setPinned(pipe!.id, !app.isPinned(pipe!.id)).catch((err) => app.toast(errorMessage(err), "error"))}>
          <Icon name="pin" />
        </button>
        <button class="btn neutral icon" title={t("Reports")} onclick={() => (reports = true)}><Icon name="chart" /></button>
        <button class="btn neutral icon" title={t("Export and import")} onclick={() => (transfer = true)}><Icon name="archive" /></button>
        {#if pipe.canManage && !app.pipeType(pipe.kind)?.confidential && !app.pipeType(pipe.kind)?.teamOnly}
          <button class="btn neutral icon" title={t("Webhooks")} onclick={() => (webhooks = true)}><Icon name="bolt" /></button>
        {/if}
        {#if pipe.canManage}
          <button class="btn neutral icon" title={t("Edit the pipe")} onclick={() => (editing = true)}><Icon name="settings" /></button>
        {/if}
        {#if pipe.canAddTasks}
          <button class="btn" onclick={() => (newTaskStage = "")}><Icon name="plus" size={18} />{t("New task")}</button>
        {/if}
      </div>
    </div>

    <div class="board" style="--columns:{boardColumns.length}">
      <div class="board-row">
        {#each boardColumns as s (s.id)}
          {@const n = load(s.id)}
          <header class="column-header" class:over={overLimit(n, s.wipLimit)}
            title={s.wipLimit ? t("Work in progress limit: {n}", { n: s.wipLimit }) : undefined}>
            <span class="status-dot" style="background:{s.color}"></span>
            <span>{s.label}</span>
            <span class="count neutral">{loadLabel(n, s.wipLimit)}</span>
            {#if overLimit(n, s.wipLimit)}<span class="sr-only">{t("Over its limit")}</span>{/if}
          </header>
        {/each}
      </div>
      {#each lanes as lane (lane.id)}
        {#if lane.label !== null}
          <div class="lane-title">{lane.label}<span class="count neutral">{Object.values(cells[lane.id]).reduce((a, l) => a + l.length, 0)}</span></div>
        {/if}
        <div class="board-row lane">
          {#each boardColumns as s (s.id)}
            {@const tasks = cells[lane.id][s.id]}
            <div class="column-body" class:drop-target={drop?.stage === s.id && drop.lane === lane.id} role="list"
              data-lane={lane.id} data-stage={s.id}
              ondragover={(e) => ondragover(e, s.id, lane.id)} {ondrop}
              ondragleave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) drop = null; }}>
              {#each tasks.filter((x) => x.id !== draggedId) as x, i (x.id)}
                {#if drop?.stage === s.id && drop.lane === lane.id && drop.index === i}<div class="drop-indicator"></div>{/if}
                <TaskCard task={x} draggable={pipe.canManage}
                  ondragstart={(e) => { e.dataTransfer?.setData("text/plain", x.id); setTimeout(() => (draggedId = x.id)); }}
                  ondragend={() => { draggedId = null; drop = null; }} />
              {/each}
              {#if drop?.stage === s.id && drop.lane === lane.id && drop.index >= tasks.filter((x) => x.id !== draggedId).length}<div class="drop-indicator"></div>{/if}
              {#if pipe.canAddTasks && lane.change === null}
                <button class="btn ghost small add" onclick={() => (newTaskStage = s.id)}><Icon name="plus" size={16} />{t("Add")}</button>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>

  {#if editing}<PipeModal spaceId={pipe.space.id} pipe={pipe} onclose={() => (editing = false)} />{/if}
  {#if reports}<ReportModal {pipe} onclose={() => (reports = false)} />{/if}
  {#if transfer}<TransferModal {pipe} onclose={() => (transfer = false)} />{/if}
  {#if webhooks}<WebhooksModal pipeId={pipe.id} onclose={() => (webhooks = false)} />{/if}
  {#if newTaskStage !== null}
    <NewTaskModal pipe={{ id: pipe.id, name: pipe.name, spaceId: pipe.space.id, kind: pipe.kind }} stage={newTaskStage || null}
      onclose={() => (newTaskStage = null)} />
  {/if}
{/if}

<style>
  .page-header { margin-bottom: 16px; }
  .archived { margin-top: 10px; align-items: center; }
  .page-header h1 { gap: 6px; flex-wrap: wrap; }
  .page-header h1 :global(.badge) { margin-left: 4px; }
  .title-input {
    font: inherit; color: inherit; border: 0; outline: none; background: none; padding: 0 2px; margin: 0;
    border-radius: 4px; min-width: 4ch; max-width: 100%; field-sizing: content;
  }
  .title-input:hover { background: var(--list-hover); }
  .title-input:focus { background: none; box-shadow: inset 0 -2px 0 var(--accent); border-radius: 0; }
  .description { margin-top: 6px; color: var(--text-secondary); max-width: 760px; }
  .filter { width: 180px; min-height: 32px; height: 32px; font-size: 14px; }
  .filter-select { width: auto; min-height: 32px; height: 32px; padding: 2px 8px; font-size: 14px; }
  .active-toggle { box-shadow: inset 0 0 0 1px var(--accent); color: var(--accent); }
  .board { overflow: auto; flex: 1; min-height: 0; padding-bottom: 8px; }
  .board-row { display: grid; grid-template-columns: repeat(var(--columns), 272px); gap: 12px; width: max-content; }
  .column-header {
    display: flex; align-items: center; gap: 8px; padding: 10px 12px 6px; font-weight: 600; font-size: 14px;
    background: var(--background-secondary); border-radius: 10px 10px 0 0; position: sticky; top: 0; z-index: 1;
  }
  .column-header.over { box-shadow: inset 0 3px 0 var(--danger, #ed2651); }
  .column-header.over .count { background: var(--danger, #ed2651); color: #fff; }
  .column-body { padding: 4px 8px 8px; display: flex; flex-direction: column; gap: 8px; min-height: 80px; background: var(--background-secondary); }
  .board-row:last-child .column-body { border-radius: 0 0 10px 10px; }
  .lane .column-body { min-height: 60px; }
  .column-body.drop-target { box-shadow: inset 0 0 0 2px var(--accent); }
  .lane-title {
    display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; color: var(--text-secondary);
    padding: 10px 4px 4px; background: var(--background); position: sticky; left: 0; width: max-content;
  }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .drop-indicator { height: 3px; background: var(--accent); border-radius: 2px; margin: -4px 0; }
  .add { justify-content: flex-start; color: var(--text-tertiary); width: 100%; }
  @media (max-width: 900px) { .page-header { flex-wrap: wrap; } }
</style>
