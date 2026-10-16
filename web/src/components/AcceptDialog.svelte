<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import type { Pipe, Task } from "../lib/types";
  import Modal from "./Modal.svelte";

  let { task, pipes, onclose, ondone }: { task: Task; pipes: Pipe[]; onclose: () => void; ondone?: () => void } = $props();

  let pipeId = $state<string | null>(untrack(() => pipes[0]?.id ?? null));
  // Column of the chosen pipe; reset to its first column when the pipe changes.
  const columns = $derived(app.columnsFor(pipes.find((p) => p.id === pipeId)?.kind));
  let stage = $state<string | null>(null);
  $effect(() => {
    stage = columns[0]?.id ?? null;
  });
  let comment = $state("");
  let busy = $state(false);
  let error = $state("");

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      await api.post(`/tasks/${task.id}/move`, { pipeId, stage, comment });
      app.toast("Tâche acceptée");
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

<Modal title="Accepter la tâche" {onclose}>
  {#if !pipes.length}
    <div class="callout warning">Cet espace n'a encore aucun pipe : créez-en un pour y ranger la tâche.</div>
    <div class="modal-actions"><a class="btn" href={`/spaces/${task.space.id}?newPipe=1`} onclick={onclose}>Créer un pipe</a></div>
  {:else}
    <form onsubmit={submit}>
      <div class="field">
        <label for="acc-pipe">Pipe</label>
        <select id="acc-pipe" class="input" bind:value={pipeId}>
          {#each pipes as p (p.id)}<option value={p.id}>{p.name}{p.visibility === "open" ? " (open)" : ""}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="acc-status">Colonne</label>
        <select id="acc-status" class="input" bind:value={stage}>
          {#each columns as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="acc-comment">Commentaire (optionnel)</label>
        <input id="acc-comment" class="input" bind:value={comment} />
      </div>
      {#if error}<div class="error-text">{error}</div>{/if}
      <div class="modal-actions">
        <button type="button" class="btn neutral" onclick={onclose}>Annuler</button>
        <button class="btn" disabled={!pipeId || busy}>Accepter</button>
      </div>
    </form>
  {/if}
</Modal>
