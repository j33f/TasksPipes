<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import type { Task, UserRef } from "../lib/types";
  import Modal from "./Modal.svelte";
  import { t } from "../lib/i18n.svelte";
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
      app.toast(t("Task sent"));
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

<Modal title={t("Send the task")} {onclose}>
  <form onsubmit={submit}>
    <p class="muted small" style="margin-top:0">
      {t("“{title}” will be put in the recipient's incoming, who can accept or refuse it.", { title: task.title })}
    </p>
    <div class="field">
      <label for="send-to">{t("Recipient")}</label>
      <SpaceSelect bind:value={spaceId} excludeId={task.inIncoming ? task.space.id : null} />
    </div>
    {#if members.length}
      <div class="field">
        <label for="send-owner">{t("Owner in the team (optional)")}</label>
        <UserSelect bind:value={assigneeId} users={members} placeholder={t("Up to the team")} />
      </div>
    {/if}
    <div class="field">
      <span class="label-text">{t("Message (optional)")}</span>
      <MarkdownEditor bind:value={comment} rows={4} placeholder={t("Context, expectations…")} />
    </div>
    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      <button type="button" class="btn neutral" onclick={onclose}>{t("Cancel")}</button>
      <button class="btn" disabled={!spaceId || busy}>{t("Send")}</button>
    </div>
  </form>
</Modal>
