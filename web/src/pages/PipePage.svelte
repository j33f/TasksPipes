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
  import IconPicker from "../components/IconPicker.svelte";
  import NewTaskModal from "../components/NewTaskModal.svelte";

  let { id }: { id: string } = $props();

  let pipe = $state<PipeDetail | null>(null);
  let error = $state("");
  let editing = $state(false);
  /** Column in which to create a task ("" = the first one). */
  let newTaskStage = $state<string | null>(null);
  let filter = $state("");
  let mineOnly = $state(false);

  // Drag & drop state
  let draggedId = $state<string | null>(null);
  let drop = $state<{ stage: string; index: number } | null>(null);

  $effect(() => {
    app.version;
    api.get<PipeDetail>(`/pipes/${id}`).then((p) => (pipe = p)).catch((err) => (error = errorMessage(err)));
  });

  const visible = $derived(
    (pipe?.tasks ?? []).filter(
      (x) =>
        (!filter.trim() || x.title.toLowerCase().includes(filter.trim().toLowerCase())) &&
        (!mineOnly || x.assignee?.id === app.me?.user.id)
    )
  );
  const boardColumns = $derived(app.columnsFor(pipe?.kind));
  const columns = $derived(
    Object.fromEntries(boardColumns.map((c) => [c.id, visible.filter((x) => x.stage === c.id)])) as Record<string, Task[]>
  );

  function ondragover(e: DragEvent, stage: string) {
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
    drop = { stage, index };
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
    const siblings = columns[drop.stage].filter((x) => x.id !== draggedId);
    const prev = siblings[drop.index - 1];
    const next = siblings[drop.index];
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next ? next.position - 1 : 1;
    const { stage } = drop;
    draggedId = null;
    drop = null;
    if (task.stage === stage && task.position === position) return;
    // Optimistic update, then reconcile with the server.
    pipe.tasks = pipe.tasks.map((x) => (x.id === task.id ? { ...x, stage, position } : x)).sort((a, b) => a.position - b.position);
    try {
      await api.post(`/tasks/${task.id}/move`, { pipeId: pipe.id, stage, position });
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
        {#if pipe.space.kind === "team"}
          <button class="btn neutral" class:active-toggle={mineOnly} onclick={() => (mineOnly = !mineOnly)}>
            <Icon name="user" size={16} />{t("Mine")}
          </button>
        {/if}
        <button class="btn neutral icon" class:active-toggle={app.isPinned(pipe.id)}
          title={app.isPinned(pipe.id) ? t("Unpin from the menu") : t("Pin to the menu")}
          onclick={() => app.setPinned(pipe!.id, !app.isPinned(pipe!.id)).catch((err) => app.toast(errorMessage(err), "error"))}>
          <Icon name="pin" />
        </button>
        {#if pipe.canManage}
          <button class="btn neutral icon" title={t("Edit the pipe")} onclick={() => (editing = true)}><Icon name="settings" /></button>
        {/if}
        {#if pipe.canAddTasks}
          <button class="btn" onclick={() => (newTaskStage = "")}><Icon name="plus" size={18} />{t("New task")}</button>
        {/if}
      </div>
    </div>

    <div class="board">
      {#each boardColumns as s (s.id)}
        {@const tasks = columns[s.id]}
        <section class="column" class:drop-target={drop?.stage === s.id}>
          <header class="column-header">
            <span class="status-dot" style="background:{s.color}"></span>
            <span>{s.label}</span>
            <span class="count neutral">{tasks.length}</span>
          </header>
          <div class="column-body" role="list" ondragover={(e) => ondragover(e, s.id)} {ondrop}
            ondragleave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) drop = null; }}>
            {#each tasks.filter((x) => x.id !== draggedId) as x, i (x.id)}
              {#if drop?.stage === s.id && drop.index === i}<div class="drop-indicator"></div>{/if}
              <TaskCard task={x} draggable={pipe.canManage}
                ondragstart={(e) => { e.dataTransfer?.setData("text/plain", x.id); setTimeout(() => (draggedId = x.id)); }}
                ondragend={() => { draggedId = null; drop = null; }} />
            {/each}
            {#if drop?.stage === s.id && drop.index >= tasks.filter((x) => x.id !== draggedId).length}<div class="drop-indicator"></div>{/if}
            {#if pipe.canAddTasks}
              <button class="btn ghost small add" onclick={() => (newTaskStage = s.id)}><Icon name="plus" size={16} />{t("Add")}</button>
            {/if}
          </div>
        </section>
      {/each}
    </div>
  </div>

  {#if editing}<PipeModal spaceId={pipe.space.id} pipe={pipe} onclose={() => (editing = false)} />{/if}
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
  .active-toggle { box-shadow: inset 0 0 0 1px var(--accent); color: var(--accent); }
  .board { display: flex; gap: 12px; overflow-x: auto; flex: 1; min-height: 0; padding-bottom: 8px; align-items: stretch; }
  .column { width: 272px; flex-shrink: 0; background: var(--background-secondary); border-radius: 10px; display: flex; flex-direction: column; max-height: 100%; }
  .column.drop-target { box-shadow: inset 0 0 0 2px var(--accent); }
  .column-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px 6px; font-weight: 600; font-size: 14px; }
  .column-body { padding: 4px 8px 8px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; min-height: 80px; flex: 1; }
  .drop-indicator { height: 3px; background: var(--accent); border-radius: 2px; margin: -4px 0; }
  .add { justify-content: flex-start; color: var(--text-tertiary); width: 100%; }
  @media (max-width: 900px) { .page-header { flex-wrap: wrap; } }
</style>
