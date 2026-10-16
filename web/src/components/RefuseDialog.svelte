<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import type { Task } from "../lib/types";
  import Modal from "./Modal.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";

  let { task, onclose, ondone }: { task: Task; onclose: () => void; ondone?: () => void } = $props();

  let reason = $state("");
  let busy = $state(false);
  let error = $state("");

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      await api.post(`/tasks/${task.id}/refuse`, { reason });
      app.toast(`Tâche renvoyée à ${task.sender?.name}`);
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

<Modal title="Refuser la tâche" {onclose}>
  <form onsubmit={submit}>
    <p class="muted small" style="margin-top:0">
      La tâche retournera dans l'incoming de <strong>{task.sender?.name}</strong> avec votre explication.
    </p>
    <div class="field">
      <span class="label-text">Raison du refus</span>
      <MarkdownEditor bind:value={reason} rows={4} autofocus placeholder="Pourquoi refusez-vous cette tâche ?" />
    </div>
    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      <button type="button" class="btn neutral" onclick={onclose}>Annuler</button>
      <button class="btn danger" disabled={!reason.trim() || busy}>Refuser</button>
    </div>
  </form>
</Modal>
