<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { STATUSES } from "../lib/constants";
  import type { DocRef, Status, UserRef } from "../lib/types";
  import Modal from "./Modal.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import SpaceSelect from "./SpaceSelect.svelte";
  import UserSelect from "./UserSelect.svelte";
  import DocPicker from "./DocPicker.svelte";
  import Icon from "./Icon.svelte";

  let { pipe = null, status: initialStatus = "backlog", spaceId: initialSpaceId = null, onclose }: {
    /** Create directly in this pipe… */
    pipe?: { id: string; name: string; spaceId: string } | null;
    status?: Status;
    /** …or send to this space's incoming bucket. */
    spaceId?: string | null;
    onclose: () => void;
  } = $props();

  let title = $state("");
  let description = $state("");
  let status = $state<Status>(untrack(() => initialStatus));
  let spaceId = $state<string | null>(untrack(() => initialSpaceId ?? app.me?.personalSpaceId ?? null));
  let assigneeId = $state<string | null>(null);
  let dueDate = $state("");
  let outlineDoc = $state<DocRef | null>(null);
  let comment = $state("");
  let busy = $state(false);
  let error = $state("");

  const toIncoming = $derived(!pipe);
  const sendingToOther = $derived(toIncoming && spaceId !== app.me?.personalSpaceId);

  // An owner is chosen only in a team; in a personal space the task belongs to that person.
  const targetSpaceId = $derived(pipe ? pipe.spaceId : spaceId);
  const isTeam = $derived(app.spaces.find((s) => s.id === targetSpaceId)?.kind === "team");
  let members = $state<UserRef[]>([]);
  $effect(() => {
    const id = targetSpaceId;
    assigneeId = null;
    members = [];
    untrack(() => app.teamMembers(id)).then((m) => { if (targetSpaceId === id) members = m; }).catch(() => {});
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      const body = {
        title, description, outlineDoc, comment,
        assigneeId: isTeam ? assigneeId : null,
        dueDate: dueDate || null,
        ...(pipe ? { pipeId: pipe.id, status } : { spaceId }),
      };
      const { id } = await api.post<{ id: string }>("/tasks", body);
      app.toast(sendingToOther ? "Tâche envoyée" : "Tâche créée");
      app.refresh();
      onclose();
      if (!sendingToOther) app.openTask(id);
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={pipe ? `Nouvelle tâche · ${pipe.name}` : "Nouvelle tâche"} {onclose}>
  <form onsubmit={submit}>
    <div class="field">
      <label for="nt-title">Titre</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="nt-title" class="input" bind:value={title} autofocus required maxlength="300" />
    </div>
    <div class="field">
      <span class="label-text">Description</span>
      <MarkdownEditor bind:value={description} rows={5} />
    </div>

    {#if pipe}
      <div class="field">
        <label for="nt-status">État</label>
        <select id="nt-status" class="input" bind:value={status}>
          {#each STATUSES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
        </select>
      </div>
    {:else}
      <div class="field">
        <label for="nt-dest">Incoming de destination</label>
        <SpaceSelect bind:value={spaceId} />
      </div>
    {/if}

    <div class="grid2">
      {#if isTeam}
        <div class="field">
          <label for="nt-owner">Propriétaire</label>
          <UserSelect bind:value={assigneeId} users={members} placeholder="Non assignée" />
        </div>
      {/if}
      <div class="field">
        <label for="nt-due">Échéance</label>
        <input id="nt-due" class="input" type="date" bind:value={dueDate} />
      </div>
    </div>

    <div class="field">
      <span class="label-text">Document Outline lié</span>
      {#if outlineDoc}
        <div class="row">
          <span class="doc-link"><Icon name="doc" size={16} /><span>{outlineDoc.title}</span></span>
          <button type="button" class="btn ghost small" onclick={() => (outlineDoc = null)}>Retirer</button>
        </div>
      {:else}
        <DocPicker onselect={(d) => (outlineDoc = d)} />
      {/if}
    </div>

    {#if sendingToOther}
      <div class="field">
        <span class="label-text">Message au destinataire (optionnel)</span>
        <MarkdownEditor bind:value={comment} rows={3} />
      </div>
    {/if}

    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      <button type="button" class="btn neutral" onclick={onclose}>Annuler</button>
      <button class="btn" disabled={busy || !title.trim() || (!pipe && !spaceId)}>
        {sendingToOther ? "Envoyer" : "Créer"}
      </button>
    </div>
  </form>
</Modal>

<style>
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
</style>
