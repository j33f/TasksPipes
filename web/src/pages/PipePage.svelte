<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { STATUSES, openTaskCount } from "../lib/constants";
  import type { PipeDetail, Status, Task } from "../lib/types";
  import SpaceIcon from "../components/SpaceIcon.svelte";
  import Icon from "../components/Icon.svelte";
  import Markdown from "../components/Markdown.svelte";
  import TaskCard from "../components/TaskCard.svelte";
  import PipeModal from "../components/PipeModal.svelte";
  import NewTaskModal from "../components/NewTaskModal.svelte";

  let { id }: { id: string } = $props();

  let pipe = $state<PipeDetail | null>(null);
  let error = $state("");
  let editing = $state(false);
  let newTaskStatus = $state<Status | null>(null);
  let filter = $state("");
  let mineOnly = $state(false);

  // Drag & drop state
  let draggedId = $state<string | null>(null);
  let drop = $state<{ status: Status; index: number } | null>(null);

  $effect(() => {
    app.version;
    api.get<PipeDetail>(`/pipes/${id}`).then((p) => (pipe = p)).catch((err) => (error = errorMessage(err)));
  });

  const visible = $derived(
    (pipe?.tasks ?? []).filter(
      (t) =>
        (!filter.trim() || t.title.toLowerCase().includes(filter.trim().toLowerCase())) &&
        (!mineOnly || t.assignee?.id === app.me?.user.id)
    )
  );
  const columns = $derived(
    Object.fromEntries(STATUSES.map((s) => [s.id, visible.filter((t) => t.status === s.id)])) as Record<Status, Task[]>
  );

  function ondragover(e: DragEvent, status: Status) {
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
    drop = { status, index };
  }

  // Every task done or abandoned: the pipe can be closed.
  const finished = $derived(Boolean(pipe?.tasks.length) && openTaskCount(pipe!.counts) === 0);

  async function setArchived(archived: boolean) {
    try {
      await api.patch(`/pipes/${id}`, { archived });
      app.toast(archived ? "Pipe archivé" : "Pipe désarchivé");
      app.refresh();
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
  }

  async function ondrop(e: DragEvent) {
    e.preventDefault();
    if (!pipe || !draggedId || !drop) return;
    const task = pipe.tasks.find((t) => t.id === draggedId)!;
    const siblings = columns[drop.status].filter((t) => t.id !== draggedId);
    const prev = siblings[drop.index - 1];
    const next = siblings[drop.index];
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next ? next.position - 1 : 1;
    const { status } = drop;
    draggedId = null;
    drop = null;
    if (task.status === status && task.position === position) return;
    // Optimistic update, then reconcile with the server.
    pipe.tasks = pipe.tasks.map((t) => (t.id === task.id ? { ...t, status, position } : t)).sort((a, b) => a.position - b.position);
    try {
      await api.post(`/tasks/${task.id}/move`, { pipeId: pipe.id, status, position });
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
          <a href={`/spaces/${pipe.space.id}`}><SpaceIcon space={pipe.space} size={16} />{pipe.space.id === app.me?.personalSpaceId ? "Mon espace" : pipe.space.name}</a>
          <span>›</span><span>Pipe</span>
        </div>
        <h1>
          <span class="color-dot" style="background:{pipe.color || 'var(--divider)'}"></span>
          {pipe.name}
          {#if pipe.archived}<span class="badge"><Icon name="archive" size={12} />Archivé</span>{/if}
          {#if app.pipeType(pipe.kind)}<span class="badge">{app.pipeType(pipe.kind)?.label}</span>{/if}
          {#if pipe.visibility === "open"}
            <span class="badge open"><Icon name="globe" size={12} />Open</span>
          {:else}
            <span class="badge">{#if pipe.space.kind === "team"}<Icon name="users" size={12} />Équipe{:else}<Icon name="lock" size={12} />Perso{/if}</span>
          {/if}
        </h1>
        {#if pipe.description}<div class="description"><Markdown source={pipe.description} compact /></div>{/if}
        {#if pipe.archived}
          <div class="callout row archived">
            <Icon name="archive" />
            <span class="grow">Ce pipe est archivé : il n'apparaît plus dans les listes et n'accepte plus de nouvelles tâches.</span>
            {#if pipe.canManage}<button class="btn small neutral" onclick={() => setArchived(false)}>Désarchiver</button>{/if}
          </div>
        {/if}
        {#if finished && !pipe.archived && !pipe.isDefault && pipe.canManage}
          <div class="callout row archived">
            <Icon name="check" />
            <span class="grow">Toutes les tâches de ce pipe sont terminées ou abandonnées.</span>
            <button class="btn small" onclick={() => setArchived(true)}><Icon name="archive" size={16} />Archiver le pipe</button>
          </div>
        {/if}
        {#if !pipe.canManage}
          <div class="subtitle">Pipe open de {pipe.space.name} : vous pouvez y ajouter des tâches et commenter ; seuls ses membres les font avancer.</div>
        {/if}
      </div>
      <div class="row wrap">
        <input class="input filter" placeholder="Filtrer…" bind:value={filter} />
        {#if pipe.space.kind === "team"}
          <button class="btn neutral" class:active-toggle={mineOnly} onclick={() => (mineOnly = !mineOnly)}>
            <Icon name="user" size={16} />Les miennes
          </button>
        {/if}
        {#if pipe.canManage}
          <button class="btn neutral icon" title="Modifier le pipe" onclick={() => (editing = true)}><Icon name="settings" /></button>
        {/if}
        {#if pipe.canAddTasks}
          <button class="btn" onclick={() => (newTaskStatus = "backlog")}><Icon name="plus" size={18} />Nouvelle tâche</button>
        {/if}
      </div>
    </div>

    <div class="board">
      {#each STATUSES as s (s.id)}
        {@const tasks = columns[s.id]}
        <section class="column" class:drop-target={drop?.status === s.id}>
          <header class="column-header">
            <span class="status-dot" style="background:{s.color}"></span>
            <span>{s.label}</span>
            <span class="count neutral">{tasks.length}</span>
          </header>
          <div class="column-body" role="list" ondragover={(e) => ondragover(e, s.id)} {ondrop}
            ondragleave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) drop = null; }}>
            {#each tasks.filter((t) => t.id !== draggedId) as t, i (t.id)}
              {#if drop?.status === s.id && drop.index === i}<div class="drop-indicator"></div>{/if}
              <TaskCard task={t} draggable={pipe.canManage}
                ondragstart={(e) => { e.dataTransfer?.setData("text/plain", t.id); setTimeout(() => (draggedId = t.id)); }}
                ondragend={() => { draggedId = null; drop = null; }} />
            {/each}
            {#if drop?.status === s.id && drop.index >= tasks.filter((t) => t.id !== draggedId).length}<div class="drop-indicator"></div>{/if}
            {#if pipe.canAddTasks}
              <button class="btn ghost small add" onclick={() => (newTaskStatus = s.id)}><Icon name="plus" size={16} />Ajouter</button>
            {/if}
          </div>
        </section>
      {/each}
    </div>
  </div>

  {#if editing}<PipeModal spaceId={pipe.space.id} pipe={pipe} onclose={() => (editing = false)} />{/if}
  {#if newTaskStatus}
    <NewTaskModal pipe={{ id: pipe.id, name: pipe.name, spaceId: pipe.space.id }} status={newTaskStatus} onclose={() => (newTaskStatus = null)} />
  {/if}
{/if}

<style>
  .page-header { margin-bottom: 16px; }
  .archived { margin-top: 10px; align-items: center; }
  .color-dot { width: 14px; height: 14px; border-radius: 4px; display: inline-block; }
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
