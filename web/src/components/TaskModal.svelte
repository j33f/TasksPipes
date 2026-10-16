<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { STATUSES, dueState, formatDate, formatDateTime, relativeTime } from "../lib/constants";
  import { eventChanges, eventIcon, eventSummary } from "../lib/events";
  import type { DocRef, Pipe, Status, TaskDetail, UserRef } from "../lib/types";
  import Modal from "./Modal.svelte";
  import Markdown from "./Markdown.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";
  import UserSelect from "./UserSelect.svelte";
  import DocPicker from "./DocPicker.svelte";
  import SendDialog from "./SendDialog.svelte";
  import RefuseDialog from "./RefuseDialog.svelte";
  import AcceptDialog from "./AcceptDialog.svelte";

  let { id, onclose }: { id: string; onclose: () => void } = $props();

  let task = $state<TaskDetail | null>(null);
  let pipes = $state<Pipe[]>([]);
  let members = $state<UserRef[]>([]);
  let loadError = $state("");
  let error = $state("");
  let busy = $state(false);

  let title = $state("");
  let editingDescription = $state(false);
  let descriptionDraft = $state("");
  let pickingDoc = $state(false);
  let creatingDoc = $state(false);
  let collections = $state<{ id: string; name: string }[]>([]);
  let collectionId = $state<string | null>(null);
  let comment = $state("");
  let commentKey = $state(0);
  let dialog = $state<"send" | "refuse" | "accept" | null>(null);

  async function load() {
    try {
      const t = await api.get<TaskDetail>(`/tasks/${id}`);
      task = t;
      title = t.title;
      if (t.permissions.manage) {
        const space = await api.get<{ pipes: Pipe[]; members: UserRef[] }>(`/spaces/${t.space.id}`);
        pipes = space.pipes;
        members = space.members;
      }
    } catch (err) {
      loadError = errorMessage(err);
    }
  }

  $effect(() => {
    app.version;
    load();
  });

  async function run(fn: () => Promise<unknown>, success?: string) {
    busy = true;
    error = "";
    try {
      await fn();
      if (success) app.toast(success);
      app.refresh();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  const patch = (body: Record<string, unknown>, success?: string) => run(() => api.patch(`/tasks/${id}`, body), success);
  const move = (pipeId: string, status: Status) => run(() => api.post(`/tasks/${id}/move`, { pipeId, status }));

  function saveTitle() {
    if (task && title.trim() && title !== task.title) patch({ title });
  }

  async function saveDescription() {
    await patch({ description: descriptionDraft });
    editingDescription = false;
  }

  function linkDoc(doc: DocRef | null) {
    pickingDoc = false;
    patch({ outlineDoc: doc }, doc ? "Document lié" : "Document délié");
  }

  async function startCreateDoc() {
    creatingDoc = true;
    try {
      collections = await api.get(`/outline/collections`);
      collectionId = collections[0]?.id ?? null;
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function createDoc() {
    await run(() => api.post(`/tasks/${id}/outline-document`, { collectionId }), "Document créé dans Outline");
    creatingDoc = false;
  }

  async function postComment(e: SubmitEvent) {
    e.preventDefault();
    await run(() => api.post(`/tasks/${id}/comments`, { body: comment }));
    comment = "";
    commentKey++;
  }

  const perms = $derived(task?.permissions);
  const due = $derived(task ? dueState(task.dueDate, task.status) : "");
</script>

<Modal large {onclose}>
  {#if loadError}
    <div class="pad"><div class="callout danger">{loadError}</div></div>
  {:else if !task}
    <div class="pad muted">Chargement…</div>
  {:else}
    <div class="task-detail">
      <section class="task-main">
        <div class="breadcrumb">
          <a href={`/spaces/${task.space.id}`} onclick={onclose}>{task.space.name}</a>
          <span>›</span>
          {#if task.pipe}
            <a href={`/pipes/${task.pipe.id}`} onclick={onclose}>{task.pipe.name}</a>
            {#if task.pipe.visibility === "open"}<span class="badge open">Open</span>{/if}
          {:else}
            <a href={`/spaces/${task.space.id}?tab=incoming`} onclick={onclose}>Incoming</a>
          {/if}
          <span class="muted">· #{task.number}</span>
        </div>

        {#if task.inIncoming && task.sender}
          <div class="callout info">
            <Icon name="inbox" />
            <div class="grow">
              <strong>{task.sender.name}</strong> a déposé cette tâche dans l'incoming de {task.space.name}.
              {#if perms?.manage}
                <div class="row" style="margin-top:8px">
                  <button class="btn small" onclick={() => (dialog = "accept")}><Icon name="check" size={16} />Accepter</button>
                  {#if perms.refuse}
                    <button class="btn small danger" onclick={() => (dialog = "refuse")}><Icon name="return" size={16} />Refuser</button>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <input class="task-title-input" bind:value={title} onblur={saveTitle} readonly={!perms?.editContent}
          onkeydown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} aria-label="Titre" />

        {#if editingDescription}
          <MarkdownEditor bind:value={descriptionDraft} rows={10} autofocus />
          <div class="row" style="margin-top:8px; justify-content:flex-end">
            <button class="btn neutral small" onclick={() => (editingDescription = false)}>Annuler</button>
            <button class="btn small" disabled={busy} onclick={saveDescription}>Enregistrer</button>
          </div>
        {:else}
          <div class="description">
            {#if task.description}
              <Markdown source={task.description} />
            {:else}
              <p class="muted">Aucune description.</p>
            {/if}
            {#if perms?.editContent}
              <button class="btn ghost small" onclick={() => { descriptionDraft = task!.description; editingDescription = true; }}>
                <Icon name="edit" size={16} />Modifier la description
              </button>
            {/if}
          </div>
        {/if}

        {#if error}<div class="error-text">{error}</div>{/if}

        <div class="timeline">
          <div class="section-title"><Icon name="history" />Historique</div>
          {#each task.events as e (e.id)}
            <div class="event" class:refused={e.type === "refused"}>
              <span class="event-icon"><Icon name={eventIcon(e.type)} size={14} /></span>
              <div class="e-body">
                <div class="e-head">
                  <strong>{e.actor.name}</strong> {eventSummary(e)}
                  <span class="e-time" title={formatDateTime(e.createdAt)}>{relativeTime(e.createdAt)}</span>
                </div>
                {#if eventChanges(e).length}
                  <ul class="e-changes">
                    {#each eventChanges(e) as c (c)}<li>{c}</li>{/each}
                  </ul>
                {/if}
                {#if e.comment}
                  <div class="e-comment">
                    {#if e.type === "refused"}<div class="small muted">Raison du refus</div>{/if}
                    <Markdown source={e.comment} compact />
                  </div>
                {/if}
              </div>
            </div>
          {/each}

          {#if perms?.comment}
            <form class="comment-form" onsubmit={postComment}>
              {#key commentKey}
                <MarkdownEditor bind:value={comment} rows={3} placeholder="Ajouter un commentaire (Markdown)…" />
              {/key}
              <div class="row" style="justify-content:flex-end; margin-top:8px">
                <button class="btn small" disabled={busy || !comment.trim()}>Commenter</button>
              </div>
            </form>
          {/if}
        </div>
      </section>

      <aside class="task-side">
        {#if perms?.manage}
          <div class="row wrap" style="margin-bottom:20px">
            <button class="btn neutral small" onclick={() => (dialog = "send")}><Icon name="send" size={16} />Envoyer à…</button>
          </div>
        {/if}

        <div class="prop">
          <span class="label-text">État</span>
          {#if perms?.manage && task.pipe}
            <select class="input" value={task.status} disabled={busy}
              onchange={(e) => move(task!.pipe!.id, (e.currentTarget as HTMLSelectElement).value as Status)}>
              {#each STATUSES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
            </select>
          {:else}
            <div class="value">{task.inIncoming ? "En attente (incoming)" : STATUSES.find((s) => s.id === task!.status)?.label}</div>
          {/if}
        </div>

        {#if perms?.manage && task.pipe}
          <div class="prop">
            <span class="label-text">Pipe</span>
            <select class="input" value={task.pipe.id} disabled={busy}
              onchange={(e) => move((e.currentTarget as HTMLSelectElement).value, task!.status)}>
              {#each pipes.filter((p) => !p.archived || p.id === task!.pipe!.id) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
            </select>
          </div>
        {/if}

        <div class="prop">
          <span class="label-text">Propriétaire</span>
          {#if perms?.manage && task.space.kind === "team"}
            <UserSelect value={task.assignee?.id ?? null} users={members} placeholder="Non assignée"
              onchange={(v) => patch({ assigneeId: v })} />
          {:else}
            <div class="value">{#if task.assignee}<Avatar user={task.assignee} size={20} />{task.assignee.name}{:else}<span class="muted">Non assignée</span>{/if}</div>
            {#if task.space.kind === "user" && perms?.manage}
              <div class="hint">Tâche personnelle. Pour la confier à quelqu'un, utilisez « Envoyer à… ».</div>
            {/if}
          {/if}
        </div>

        <div class="prop">
          <span class="label-text">Échéance</span>
          {#if perms?.manage}
            <input class="input due {due}" type="date" value={task.dueDate ?? ""}
              onchange={(e) => patch({ dueDate: (e.currentTarget as HTMLInputElement).value || null })} />
          {:else}
            <div class="value due {due}">{formatDate(task.dueDate) || "—"}</div>
          {/if}
        </div>

        <div class="prop">
          <span class="label-text">Document Outline</span>
          {#if task.outlineDoc}
            <div class="value">
              <a class="doc-link" href={task.outlineDoc.url ?? "#"} target="_blank" rel="noreferrer">
                <Icon name="doc" size={16} /><span>{task.outlineDoc.title}</span>
              </a>
              {#if perms?.manage}
                <button class="btn ghost icon small" title="Délier" onclick={() => linkDoc(null)}><Icon name="unlink" size={16} /></button>
              {/if}
            </div>
          {:else if perms?.manage}
            {#if pickingDoc}
              <DocPicker onselect={linkDoc} autofocus />
              <button class="btn ghost small" onclick={() => (pickingDoc = false)}>Annuler</button>
            {:else if creatingDoc}
              <select class="input" bind:value={collectionId}>
                {#each collections as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
              </select>
              <div class="row" style="margin-top:6px">
                <button class="btn small" disabled={!collectionId || busy} onclick={createDoc}>Créer</button>
                <button class="btn ghost small" onclick={() => (creatingDoc = false)}>Annuler</button>
              </div>
            {:else}
              <div class="row wrap">
                <button class="btn neutral small" onclick={() => (pickingDoc = true)}>Lier un document</button>
                <button class="btn ghost small" onclick={startCreateDoc}>Créer dans Outline</button>
              </div>
            {/if}
          {:else}
            <div class="value muted">—</div>
          {/if}
        </div>

        <div class="prop">
          <span class="label-text">Auteur·rice</span>
          <div class="value"><Avatar user={task.author} size={20} />{task.author.name}</div>
        </div>
        <div class="prop">
          <span class="label-text">Créée</span>
          <div class="value">{formatDateTime(task.createdAt)}</div>
        </div>
      </aside>
    </div>
  {/if}
</Modal>

{#if task && dialog === "send"}<SendDialog {task} onclose={() => (dialog = null)} />{/if}
{#if task && dialog === "refuse"}<RefuseDialog {task} onclose={() => (dialog = null)} ondone={onclose} />{/if}
{#if task && dialog === "accept"}<AcceptDialog {task} pipes={pipes.filter((p) => !p.archived)} onclose={() => (dialog = null)} />{/if}

<style>
  .pad { padding: 28px 32px; }
  .grow { flex: 1; }
  .task-detail { display: grid; grid-template-columns: 1fr 300px; min-height: 60vh; }
  .task-main { padding: 28px 32px; min-width: 0; }
  .task-side { border-left: 1px solid var(--divider); padding: 52px 20px 28px; background: var(--background-secondary); border-radius: 0 12px 12px 0; }
  .task-title-input { font-size: 26px; font-weight: 600; border: 0; outline: none; background: none; color: var(--text); width: 100%; font-family: inherit; padding: 0; margin: 4px 0 12px; }
  .description :global(.btn) { margin-top: 8px; }
  .prop { margin-bottom: 14px; }
  .prop .label-text { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
  .prop .value { font-size: 14px; display: flex; align-items: center; gap: 6px; min-height: 28px; }
  .prop .input { min-height: 32px; padding: 4px 8px; font-size: 14px; }
  .timeline { margin-top: 32px; }
  .event { display: flex; gap: 10px; padding: 8px 0; font-size: 14px; }
  .e-body { flex: 1; min-width: 0; }
  .e-head { color: var(--text-secondary); }
  .e-head strong { color: var(--text); font-weight: 600; }
  .e-time { color: var(--text-tertiary); font-size: 12px; margin-left: 6px; }
  .e-changes { margin: 4px 0 0; padding: 0; list-style: none; color: var(--text-secondary); font-size: 13px; }
  .e-changes li::before { content: "→ "; color: var(--text-tertiary); }
  .e-comment { margin-top: 6px; background: var(--card-background); box-shadow: var(--card-shadow); border-radius: 8px; padding: 8px 12px; }
  .event.refused .e-comment { box-shadow: inset 3px 0 0 var(--danger), var(--card-shadow); }
  .event-icon { width: 24px; height: 24px; border-radius: 50%; background: var(--background-secondary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--text-tertiary); }
  .comment-form { margin-top: 12px; }
  @media (max-width: 900px) {
    .task-detail { grid-template-columns: 1fr; }
    .task-main { padding: 20px; }
    .task-side { border-left: 0; border-top: 1px solid var(--divider); border-radius: 0 0 12px 12px; padding: 20px; }
  }
</style>
