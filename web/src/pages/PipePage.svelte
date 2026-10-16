<script lang="ts">
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
      (t) =>
        (!filter.trim() || t.title.toLowerCase().includes(filter.trim().toLowerCase())) &&
        (!mineOnly || t.assignee?.id === app.me?.user.id)
    )
  );
  const boardColumns = $derived(app.columnsFor(pipe?.kind));
  const columns = $derived(
    Object.fromEntries(boardColumns.map((c) => [c.id, visible.filter((t) => t.stage === c.id)])) as Record<string, Task[]>
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
    const siblings = columns[drop.stage].filter((t) => t.id !== draggedId);
    const prev = siblings[drop.index - 1];
    const next = siblings[drop.index];
    const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next ? next.position - 1 : 1;
    const { stage } = drop;
    draggedId = null;
    drop = null;
    if (task.stage === stage && task.position === position) return;
    // Optimistic update, then reconcile with the server.
    pipe.tasks = pipe.tasks.map((t) => (t.id === task.id ? { ...t, stage, position } : t)).sort((a, b) => a.position - b.position);
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
          <a href={`/spaces/${pipe.space.id}`}><SpaceIcon space={pipe.space} size={16} />{pipe.space.id === app.me?.personalSpaceId ? "Mon espace" : pipe.space.name}</a>
          <span>›</span><span>Pipe</span>
        </div>
        <h1>
          <IconPicker icon={pipe.icon} color={pipe.color} kind={pipe.kind} editable={pipe.canManage} size={28}
            onchange={(next) => save(next)} />
          {#if pipe.canManage}
            <input class="title-input" value={pipe.name} maxlength="120" aria-label="Nom du pipe" onblur={rename} onkeydown={titleKeydown} />
          {:else}
            {pipe.name}
          {/if}
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
        <button class="btn neutral icon" class:active-toggle={app.isPinned(pipe.id)}
          title={app.isPinned(pipe.id) ? "Désépingler du menu" : "Épingler dans le menu"}
          onclick={() => app.setPinned(pipe!.id, !app.isPinned(pipe!.id)).catch((err) => app.toast(errorMessage(err), "error"))}>
          <Icon name="pin" />
        </button>
        {#if pipe.canManage}
          <button class="btn neutral icon" title="Modifier le pipe" onclick={() => (editing = true)}><Icon name="settings" /></button>
        {/if}
        {#if pipe.canAddTasks}
          <button class="btn" onclick={() => (newTaskStage = "")}><Icon name="plus" size={18} />Nouvelle tâche</button>
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
            {#each tasks.filter((t) => t.id !== draggedId) as t, i (t.id)}
              {#if drop?.stage === s.id && drop.index === i}<div class="drop-indicator"></div>{/if}
              <TaskCard task={t} draggable={pipe.canManage}
                ondragstart={(e) => { e.dataTransfer?.setData("text/plain", t.id); setTimeout(() => (draggedId = t.id)); }}
                ondragend={() => { draggedId = null; drop = null; }} />
            {/each}
            {#if drop?.stage === s.id && drop.index >= tasks.filter((t) => t.id !== draggedId).length}<div class="drop-indicator"></div>{/if}
            {#if pipe.canAddTasks}
              <button class="btn ghost small add" onclick={() => (newTaskStage = s.id)}><Icon name="plus" size={16} />Ajouter</button>
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
