<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import type { Pipe, Task } from "../lib/types";
  import Modal from "./Modal.svelte";
  import { t } from "../lib/i18n.svelte";

  let { task, pipes, onclose, ondone }: { task: Task; pipes: Pipe[]; onclose: () => void; ondone?: () => void } = $props();

  let pipeId = $state<string | null>(untrack(() => pipes[0]?.id ?? null));
  // Column of the chosen pipe; reset to its first column when the pipe changes.
  const kind = $derived(pipes.find((p) => p.id === pipeId)?.kind);
  const columns = $derived(app.columnsFor(kind));
  let stage = $state<string | null>(null);
  $effect(() => {
    stage = columns[0]?.id ?? null;
  });
  // Its type can be changed to one the chosen pipe offers; it keeps its own by default.
  const current = $derived(app.taskType(task.taskType));
  const typeChoices = $derived.by(() => {
    const list = app.taskTypesFor(kind);
    return current && !list.some((x) => x.id === current.id) ? [current, ...list] : list;
  });
  let taskType = $state(untrack(() => task.taskType));
  let comment = $state("");
  let busy = $state(false);
  let error = $state("");

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      await api.post(`/tasks/${task.id}/move`, { pipeId, stage, comment, ...(taskType !== task.taskType ? { taskType } : {}) });
      app.toast(t("Task accepted"));
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

<Modal title={t("Accept the task")} {onclose}>
  {#if !pipes.length}
    <div class="callout warning">{t("This space has no pipe yet: create one to put the task in.")}</div>
    <div class="modal-actions"><a class="btn" href={`/spaces/${task.space.id}?newPipe=1`} onclick={onclose}>{t("Create a pipe")}</a></div>
  {:else}
    <form onsubmit={submit}>
      <div class="field">
        <label for="acc-pipe">{t("Pipe")}</label>
        <select id="acc-pipe" class="input" bind:value={pipeId}>
          {#each pipes as p (p.id)}<option value={p.id}>{p.name}{p.visibility === "open" ? " (open)" : ""}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="acc-status">{t("Column")}</label>
        <select id="acc-status" class="input" bind:value={stage}>
          {#each columns as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
        </select>
      </div>
      {#if typeChoices.length > 1}
        <div class="field">
          <label for="acc-type">{t("Task type")}</label>
          <select id="acc-type" class="input" bind:value={taskType}>
            {#each typeChoices as tt (tt.id)}<option value={tt.id}>{tt.label}</option>{/each}
          </select>
          {#if current && taskType === current.id && !app.taskTypesFor(kind).some((x) => x.id === current.id)}
            <div class="hint">{t("This pipe does not offer this type: you can turn the task into one of its types.")}</div>
          {/if}
        </div>
      {/if}
      <div class="field">
        <label for="acc-comment">{t("Comment (optional)")}</label>
        <input id="acc-comment" class="input" bind:value={comment} />
      </div>
      {#if error}<div class="error-text">{error}</div>{/if}
      <div class="modal-actions">
        <button type="button" class="btn neutral" onclick={onclose}>{t("Cancel")}</button>
        <button class="btn" disabled={!pipeId || busy}>{t("Accept")}</button>
      </div>
    </form>
  {/if}
</Modal>
