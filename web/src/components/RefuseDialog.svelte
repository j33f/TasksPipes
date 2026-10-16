<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import type { Task } from "../lib/types";
  import Modal from "./Modal.svelte";
  import { t } from "../lib/i18n.svelte";
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
      app.toast(t("Task sent back to {name}", { name: task.sender?.name ?? "" }));
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

<Modal title={t("Refuse the task")} {onclose}>
  <form onsubmit={submit}>
    <p class="muted small" style="margin-top:0">
      {t("The task will go back to the incoming of {name} with your explanation.", { name: task.sender?.name ?? "" })}
    </p>
    <div class="field">
      <span class="label-text">{t("Reason for refusing")}</span>
      <MarkdownEditor bind:value={reason} rows={4} autofocus placeholder={t("Why do you refuse this task?")} />
    </div>
    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      <button type="button" class="btn neutral" onclick={onclose}>{t("Cancel")}</button>
      <button class="btn danger" disabled={!reason.trim() || busy}>{t("Refuse")}</button>
    </div>
  </form>
</Modal>
