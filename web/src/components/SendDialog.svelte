<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import type { Task, UserRef } from "../lib/types";
  import Modal from "./Modal.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import SpaceSelect from "./SpaceSelect.svelte";
  import UserSelect from "./UserSelect.svelte";

  let { task, onclose, ondone }: { task: Task; onclose: () => void; ondone?: () => void } = $props();

  let spaceId = $state<string | null>(null);
  let comment = $state("");
  let assigneeId = $state<string | null>(null);
  let members = $state<UserRef[]>([]);

  // Sending to a team may name the owner there; sent to a person, the task becomes theirs.
  $effect(() => {
    const id = spaceId;
    assigneeId = null;
    members = [];
    untrack(() => app.teamMembers(id)).then((m) => { if (spaceId === id) members = m; }).catch(() => {});
  });
  let busy = $state(false);
  let error = $state("");

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!spaceId) return;
    busy = true;
    try {
      await api.post(`/tasks/${task.id}/send`, { spaceId, comment, assigneeId });
      app.toast("Tâche envoyée");
      app.refresh();
      ondone?.();
      onclose();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Envoyer la tâche" {onclose}>
  <form onsubmit={submit}>
    <p class="muted small" style="margin-top:0">
      « {task.title} » sera déposée dans l'incoming du destinataire, qui pourra l'accepter ou la refuser.
    </p>
    <div class="field">
      <label for="send-to">Destinataire</label>
      <SpaceSelect bind:value={spaceId} excludeId={task.inIncoming ? task.space.id : null} />
    </div>
    {#if members.length}
      <div class="field">
        <label for="send-owner">Propriétaire dans l'équipe (optionnel)</label>
        <UserSelect bind:value={assigneeId} users={members} placeholder="À définir par l'équipe" />
      </div>
    {/if}
    <div class="field">
      <span class="label-text">Message (optionnel)</span>
      <MarkdownEditor bind:value={comment} rows={4} placeholder="Contexte, attentes…" />
    </div>
    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      <button type="button" class="btn neutral" onclick={onclose}>Annuler</button>
      <button class="btn" disabled={!spaceId || busy}>Envoyer</button>
    </div>
  </form>
</Modal>
