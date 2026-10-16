<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import type { DocRef, UserRef } from "../lib/types";
  import Modal from "./Modal.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import SpaceSelect from "./SpaceSelect.svelte";
  import UserSelect from "./UserSelect.svelte";
  import DocPicker from "./DocPicker.svelte";
  import Icon, { iconOf } from "./Icon.svelte";
  import TaskFields, { type FieldFile } from "./TaskFields.svelte";
  import Checklist from "./Checklist.svelte";
  import type { ChecklistItem } from "../lib/types";
  import { t } from "../lib/i18n.svelte";

  let { pipe = null, stage: initialStage = null, spaceId: initialSpaceId = null, onclose }: {
    /** Create directly in this pipe… */
    pipe?: { id: string; name: string; spaceId: string; kind: string } | null;
    /** Column of the pipe (its first one by default). */
    stage?: string | null;
    /** …or send to this space's incoming bucket. */
    spaceId?: string | null;
    onclose: () => void;
  } = $props();

  let title = $state("");
  let description = $state("");
  const columns = $derived(pipe ? app.columnsFor(pipe.kind) : []);
  let stage = $state<string | null>(untrack(() => initialStage ?? (pipe ? app.columnsFor(pipe.kind)[0]?.id : null) ?? null));

  // Task type: those of the pipe type, or any of them when sending to an incoming bucket.
  const typeChoices = $derived(pipe ? app.taskTypesFor(pipe.kind) : app.taskTypes.filter((tt) => app.usable(tt)));
  // Default: the pipe type's main task type, except in checklist processes (with starter tasks) where plain tasks prevail.
  let taskTypeId = $state(
    untrack(() => (pipe && !app.pipeType(pipe.kind)?.templates.length ? app.taskTypesFor(pipe.kind)[1]?.id : null) ?? "task")
  );
  const taskType = $derived(app.taskType(taskTypeId));
  let fields = $state<Record<string, unknown>>({});
  let pending = $state<FieldFile[]>([]);
  let spaceId = $state<string | null>(untrack(() => initialSpaceId ?? app.me?.personalSpaceId ?? null));
  let assigneeId = $state<string | null>(null);
  let dueDate = $state("");
  let outlineDoc = $state<DocRef | null>(null);
  let comment = $state("");
  let items = $state<ChecklistItem[]>([]);
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
        taskType: taskTypeId,
        items: items.map(({ text, done }) => ({ text, done })),
        // Only the fields of the chosen type (the type may have changed after filling some).
        fields: Object.fromEntries(Object.entries(fields).filter(([k]) => taskType?.fields.some((f) => f.id === k))),
        ...(pipe ? { pipeId: pipe.id, stage } : { spaceId }),
      };
      const { id } = await api.post<{ id: string }>("/tasks", body);
      for (const p of pending.filter((x) => taskType?.fields.some((f) => f.id === x.field))) {
        await api.upload(`/tasks/${id}/files?field=${encodeURIComponent(p.field)}`, p.file!).catch((err) =>
          app.toast(`${p.name} : ${errorMessage(err)}`, "error")
        );
      }
      app.toast(sendingToOther ? t("Task sent") : t("Task created"));
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

<Modal title={pipe ? `${t("New task")} · ${pipe.name}` : t("New task")} large={Boolean(taskType?.fields.length)} {onclose}>
  <form onsubmit={submit}>
    {#if typeChoices.length > 1}
      <div class="field">
        <span class="label-text">{t("Task type")}</span>
        <div class="types">
          {#each typeChoices as tt (tt.id)}
            <button type="button" class="type-card" class:selected={taskTypeId === tt.id} title={tt.description} onclick={() => (taskTypeId = tt.id)}>
              <Icon name={iconOf(tt.icon)} size={16} />{tt.label}
            </button>
          {/each}
        </div>
      </div>
    {/if}
    <div class="field">
      <label for="nt-title">{t("Title")}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="nt-title" class="input" bind:value={title} autofocus required maxlength="300" />
    </div>
    <div class="field">
      <span class="label-text">{t("Description")}</span>
      <MarkdownEditor bind:value={description} rows={5} />
    </div>

    <div class="field">
      <span class="label-text">{t("Sub-tasks")}</span>
      <Checklist {items}
        onadd={(text) => { items = [...items, { id: `new-${Math.random()}`, text, done: false, position: Math.max(0, ...items.map((i) => i.position)) + 1 }]; }}
        ontoggle={(item) => (item.done = !item.done)}
        onrename={(item, text) => (item.text = text)}
        ondelete={(item) => (items = items.filter((i) => i !== item))}
        onmove={(item, position) => { item.position = position; items = [...items].sort((a, b) => a.position - b.position); }} />
    </div>

    {#if taskType?.fields.length}
      <div class="section-title">{taskType.label}</div>
      <TaskFields type={taskType} values={fields} files={pending}
        onchange={(id, v) => (fields = { ...fields, [id]: v })}
        onupload={(field, list) => (pending = [...pending, ...list.map((file) => ({ field, name: file.name, size: file.size, file }))])}
        ondeletefile={(file) => (pending = pending.filter((x) => x !== file))} />
    {/if}

    {#if pipe}
      <div class="field">
        <label for="nt-status">{t("Column")}</label>
        <select id="nt-status" class="input" bind:value={stage}>
          {#each columns as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
        </select>
      </div>
    {:else}
      <div class="field">
        <label for="nt-dest">{t("Destination incoming")}</label>
        <SpaceSelect bind:value={spaceId} />
      </div>
    {/if}

    <div class="grid2">
      {#if isTeam}
        <div class="field">
          <label for="nt-owner">{t("Owner")}</label>
          <UserSelect bind:value={assigneeId} users={members} placeholder={t("Unassigned")} />
        </div>
      {/if}
      <div class="field">
        <label for="nt-due">{t("Due date")}</label>
        <input id="nt-due" class="input" type="date" bind:value={dueDate} />
      </div>
    </div>

    {#if !app.isGuest}
    <div class="field">
      <span class="label-text">{t("Linked Outline document")}</span>
      {#if outlineDoc}
        <div class="row">
          <span class="doc-link"><Icon name="doc" size={16} /><span>{outlineDoc.title}</span></span>
          <button type="button" class="btn ghost small" onclick={() => (outlineDoc = null)}>{t("Remove")}</button>
        </div>
      {:else}
        <DocPicker onselect={(d) => (outlineDoc = d)} />
      {/if}
    </div>
    {/if}

    {#if sendingToOther}
      <div class="field">
        <span class="label-text">{t("Message to the recipient (optional)")}</span>
        <MarkdownEditor bind:value={comment} rows={3} />
      </div>
    {/if}

    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      <button type="button" class="btn neutral" onclick={onclose}>{t("Cancel")}</button>
      <button class="btn" disabled={busy || !title.trim() || (!pipe && !spaceId)}>
        {sendingToOther ? t("Send") : t("Create")}
      </button>
    </div>
  </form>
</Modal>

<style>
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .types { display: flex; flex-wrap: wrap; gap: 6px; }
  .type-card {
    display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--input-border); border-radius: 8px;
    padding: 6px 10px; background: none; color: var(--text); font: inherit; font-size: 14px; cursor: pointer;
  }
  .type-card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .section-title { margin-top: 4px; }
</style>
