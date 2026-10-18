<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { STATUSES, dueState, formatDate, formatDateTime, relativeTime } from "../lib/constants";
  import TaskFields, { type FieldFile } from "./TaskFields.svelte";
  import { eventChanges, eventIcon, eventSummary } from "../lib/events";
  import type { ChecklistItem, DocRef, Pipe, TaskDetail, UserRef } from "../lib/types";
  import Modal from "./Modal.svelte";
  import Markdown from "./Markdown.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import Avatar from "./Avatar.svelte";
  import Icon, { iconOf } from "./Icon.svelte";
  import UserSelect from "./UserSelect.svelte";
  import DocPicker from "./DocPicker.svelte";
  import SendDialog from "./SendDialog.svelte";
  import RefuseDialog from "./RefuseDialog.svelte";
  import AcceptDialog from "./AcceptDialog.svelte";
  import Checklist from "./Checklist.svelte";
  import DevLinks from "./DevLinks.svelte";
  import TaskTiming from "./TaskTiming.svelte";
  import RepeatSection from "./RepeatSection.svelte";
  import { mentionableOn } from "../lib/mentions";
  import { t, tn } from "../lib/i18n.svelte";

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
      const detail = await api.get<TaskDetail>(`/tasks/${id}`);
      task = detail;
      title = detail.title;
      if (detail.permissions.manage) {
        const space = await api.get<{ pipes: Pipe[]; members: UserRef[] }>(`/spaces/${detail.space.id}`);
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
  const move = (pipeId: string, stage?: string) => run(() => api.post(`/tasks/${id}/move`, { pipeId, stage }));

  // Sub-tasks: changed in place first so the list reacts at once.
  const items = {
    add: (text: string) => run(() => api.post(`/tasks/${id}/items`, { text })),
    toggle(item: ChecklistItem) {
      item.done = !item.done;
      run(() => api.patch(`/items/${item.id}`, { done: item.done }));
    },
    rename(item: ChecklistItem, text: string) {
      item.text = text;
      run(() => api.patch(`/items/${item.id}`, { text }));
    },
    remove(item: ChecklistItem) {
      task!.items = task!.items.filter((i) => i !== item);
      run(() => api.del(`/items/${item.id}`));
    },
    move(item: ChecklistItem, position: number) {
      item.position = position;
      task!.items = [...task!.items].sort((a, b) => a.position - b.position);
      run(() => api.patch(`/items/${item.id}`, { position }));
    },
  };

  const saveField = (fieldId: string, value: unknown) => patch({ fields: { [fieldId]: value } });

  async function uploadFiles(field: string, files: File[]) {
    await run(async () => {
      for (const file of files) await api.upload(`/tasks/${id}/files?field=${encodeURIComponent(field)}`, file);
    }, tn(files.length, "File added", "{n} files added"));
  }

  function deleteFile(file: FieldFile) {
    if (file.id && confirm(t("Remove “{name}”?", { name: file.name }))) run(() => api.del(`/files/${file.id}`), t("File removed"));
  }

  const taskType = $derived(app.taskType(task?.taskType));
  // Types it can be turned into: those of the pipe type (in an incoming, those of the space's pipes), plus the current
  // one if it comes from elsewhere.
  const typeChoices = $derived.by(() => {
    if (!task) return [];
    const list = task.pipe ? app.taskTypesFor(task.pipe.kind) : app.taskTypesForPipes(pipes);
    return taskType && !list.some((x) => x.id === taskType.id) ? [...list, taskType] : list;
  });

  function saveTitle() {
    if (task && title.trim() && title !== task.title) patch({ title });
  }

  async function saveDescription() {
    await patch({ description: descriptionDraft });
    editingDescription = false;
  }

  function linkDoc(doc: DocRef | null) {
    pickingDoc = false;
    patch({ outlineDoc: doc }, doc ? t("Document linked") : t("Document unlinked"));
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
    await run(() => api.post(`/tasks/${id}/outline-document`, { collectionId }), t("Document created in Outline"));
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

<Modal large flush {onclose}>
  {#if loadError}
    <div class="pad"><div class="callout danger">{loadError}</div></div>
  {:else if !task}
    <div class="pad muted">{t("Loading…")}</div>
  {:else}
    <div class="task-detail">
      <section class="task-main">
        <div class="breadcrumb">
          <a href={`/spaces/${task.space.id}`} onclick={onclose}>{task.space.name}</a>
          <span>›</span>
          {#if task.pipe}
            <a href={`/pipes/${task.pipe.id}`} onclick={onclose}>{task.pipe.name}</a>
            {#if task.pipe.visibility === "open"}<span class="badge open">{t("Open")}</span>{/if}
          {:else}
            <a href={`/spaces/${task.space.id}?tab=incoming`} onclick={onclose}>Incoming</a>
          {/if}
          <span class="muted">· #{task.number}</span>
        </div>

        {#if task.inIncoming && task.sender}
          <div class="callout info">
            <Icon name="inbox" />
            <div class="grow">
              {t("{name} put this task in the incoming of {space}.", { name: task.sender.name, space: task.space.name })}
              {#if perms?.manage}
                <div class="row" style="margin-top:8px">
                  <button class="btn small" onclick={() => (dialog = "accept")}><Icon name="check" size={16} />{t("Accept")}</button>
                  {#if perms.refuse}
                    <button class="btn small danger" onclick={() => (dialog = "refuse")}><Icon name="return" size={16} />{t("Refuse")}</button>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <input class="task-title-input" bind:value={title} onblur={saveTitle} readonly={!perms?.editContent}
          onkeydown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} aria-label={t("Title")} />

        {#if editingDescription}
          <MarkdownEditor bind:value={descriptionDraft} rows={10} autofocus mentions={mentionableOn(task.id)} />
          <div class="row" style="margin-top:8px; justify-content:flex-end">
            <button class="btn neutral small" onclick={() => (editingDescription = false)}>{t("Cancel")}</button>
            <button class="btn small" disabled={busy} onclick={saveDescription}>{t("Save")}</button>
          </div>
        {:else}
          <div class="description">
            {#if task.description}
              <Markdown source={task.description} />
            {:else}
              <p class="muted">{t("No description.")}</p>
            {/if}
            {#if perms?.editContent}
              <button class="btn ghost small" onclick={() => { descriptionDraft = task!.description; editingDescription = true; }}>
                <Icon name="edit" size={16} />{t("Edit the description")}
              </button>
            {/if}
          </div>
        {/if}

        {#if error}<div class="error-text">{error}</div>{/if}

        {#if task.items.length || perms?.editContent}
          <div class="infos">
            <div class="section-title"><Icon name="checklist" />{t("Sub-tasks")}</div>
            <Checklist items={task.items} editable={Boolean(perms?.editContent)}
              onadd={items.add} ontoggle={items.toggle} onrename={items.rename} ondelete={items.remove} onmove={items.move} />
          </div>
        {/if}

        {#if task.gitConnected || task.links.length}
          <div class="infos">
            <div class="section-title"><Icon name="branch" />{t("Development")}</div>
            <DevLinks taskKey={task.key} title={task.title} links={task.links} />
          </div>
        {/if}

        {#if taskType?.fields.length}
          <div class="infos">
            <div class="section-title"><Icon name={iconOf(taskType.icon)} />{taskType.label}</div>
            <TaskFields type={taskType} values={task.fields} files={task.files} editable={Boolean(perms?.editContent)}
              onchange={saveField} onupload={uploadFiles} ondeletefile={deleteFile} />
          </div>
        {/if}

        <div class="timeline">
          <div class="section-title"><Icon name="history" />{t("History")}</div>
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
                    {#if e.type === "refused"}<div class="small muted">{t("Reason for refusing")}</div>{/if}
                    <Markdown source={e.comment} compact />
                  </div>
                {/if}
              </div>
            </div>
          {/each}

          {#if perms?.comment}
            <form class="comment-form" onsubmit={postComment}>
              {#key commentKey}
                <MarkdownEditor bind:value={comment} rows={3} placeholder={t("Add a comment (Markdown)…")} mentions={mentionableOn(task.id)} />
              {/key}
              <div class="row" style="justify-content:flex-end; margin-top:8px">
                <button class="btn small" disabled={busy || !comment.trim()}>{t("Comment")}</button>
              </div>
            </form>
          {/if}
        </div>
      </section>

      <aside class="task-side">
        {#if perms?.manage && !app.pipeType(task.pipe?.kind)?.teamOnly}
          <div class="row wrap" style="margin-bottom:20px">
            <button class="btn neutral small" onclick={() => (dialog = "send")}><Icon name="send" size={16} />{t("Send to…")}</button>
          </div>
        {/if}

        <div class="prop">
          <span class="label-text">{t("State")}</span>
          {#if perms?.manage && task.pipe}
            <select class="input" value={task.stage} disabled={busy}
              onchange={(e) => move(task!.pipe!.id, (e.currentTarget as HTMLSelectElement).value)}>
              {#each app.columnsFor(task.pipe.kind) as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
            </select>
          {:else}
            <div class="value">
              {task.inIncoming ? t("Waiting (incoming)") : app.columnOf(task)?.label ?? t(STATUSES.find((s) => s.id === task!.status)?.label ?? "")}
            </div>
          {/if}
        </div>

        {#if perms?.manage && task.pipe}
          <div class="prop">
            <span class="label-text">{t("Pipe")}</span>
            <select class="input" value={task.pipe.id} disabled={busy}
              onchange={(e) => move((e.currentTarget as HTMLSelectElement).value)}>
              {#each pipes.filter((p) => !p.archived || p.id === task!.pipe!.id) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
            </select>
          </div>
        {/if}

        <div class="prop">
          <span class="label-text">{t("Task type")}</span>
          {#if perms?.editContent && typeChoices.length > 1}
            <select class="input" value={task.taskType} disabled={busy}
              onchange={(e) => patch({ taskType: (e.currentTarget as HTMLSelectElement).value })}>
              {#each typeChoices as tt (tt.id)}<option value={tt.id}>{tt.label}</option>{/each}
            </select>
          {:else}
            <div class="value"><Icon name={iconOf(taskType?.icon)} size={16} />{taskType?.label ?? task.taskType}</div>
          {/if}
        </div>

        <div class="prop">
          <span class="label-text">{t("Owner")}</span>
          {#if perms?.manage && task.space.kind === "team"}
            <UserSelect value={task.assignee?.id ?? null} users={members} placeholder={t("Unassigned")}
              onchange={(v) => patch({ assigneeId: v })} />
          {:else}
            <div class="value">{#if task.assignee}<Avatar user={task.assignee} size={20} />{task.assignee.name}{:else}<span class="muted">{t("Unassigned")}</span>{/if}</div>
            {#if task.space.kind === "user" && perms?.manage}
              <div class="hint">{t("Personal task. To hand it to someone, use “Send to…”.")}</div>
            {/if}
          {/if}
        </div>

        <div class="prop">
          <span class="label-text">{t("Due date")}</span>
          {#if perms?.manage}
            <input class="input due {due}" type="date" value={task.dueDate ?? ""}
              onchange={(e) => patch({ dueDate: (e.currentTarget as HTMLInputElement).value || null })} />
          {:else}
            <div class="value due {due}">{formatDate(task.dueDate) || "—"}</div>
          {/if}
        </div>

        <div class="prop">
          <span class="label-text">{t("Outline document")}</span>
          {#if task.outlineDoc}
            <div class="value">
              <a class="doc-link" href={task.outlineDoc.url ?? "#"} target="_blank" rel="noreferrer">
                <Icon name="doc" size={16} /><span>{task.outlineDoc.title}</span>
              </a>
              {#if perms?.manage}
                <button class="btn ghost icon small" title={t("Unlink")} onclick={() => linkDoc(null)}><Icon name="unlink" size={16} /></button>
              {/if}
            </div>
          {:else if perms?.manage && !app.isGuest}
            {#if pickingDoc}
              <DocPicker onselect={linkDoc} autofocus />
              <button class="btn ghost small" onclick={() => (pickingDoc = false)}>{t("Cancel")}</button>
            {:else if creatingDoc}
              <select class="input" bind:value={collectionId}>
                {#each collections as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
              </select>
              <div class="row" style="margin-top:6px">
                <button class="btn small" disabled={!collectionId || busy} onclick={createDoc}>{t("Create")}</button>
                <button class="btn ghost small" onclick={() => (creatingDoc = false)}>{t("Cancel")}</button>
              </div>
            {:else}
              <div class="row wrap">
                <button class="btn neutral small" onclick={() => (pickingDoc = true)}>{t("Link a document")}</button>
                <button class="btn ghost small" onclick={startCreateDoc}>{t("Create in Outline")}</button>
              </div>
            {/if}
          {:else}
            <div class="value muted">—</div>
          {/if}
        </div>

        {#if task.pipe}<RepeatSection {task} onchange={load} />{/if}

        <div class="prop">
          <span class="label-text">{t("Time per step")}</span>
          <TaskTiming timing={task.timing} />
        </div>

        <div class="prop">
          <span class="label-text">{t("Author")}</span>
          <div class="value"><Avatar user={task.author} size={20} />{task.author.name}</div>
        </div>
        <div class="prop">
          <span class="label-text">{t("Created")}</span>
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
  .infos { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--divider); }
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
