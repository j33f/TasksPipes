<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { dueState, formatDate } from "../lib/constants";
  import { columnWith, suggestions } from "../lib/gtd";
  import type { Task } from "../lib/types";
  import Icon, { iconOf } from "../components/Icon.svelte";
  import TaskRow from "../components/TaskRow.svelte";
  import { t } from "../lib/i18n.svelte";

  /** Beyond this many tasks in progress, finishing one is suggested before starting another. */
  const WIP_LIMIT = 3;

  let tasks = $state<Task[] | null>(null);
  let skipped = $state<string[]>([]);
  let capture = $state("");
  let busy = $state(false);

  $effect(() => {
    app.version;
    api.get<Task[]>("/me/tasks").then((d) => (tasks = d));
  });

  const doing = $derived((tasks ?? []).filter((task) => task.status === "started" || task.status === "ongoing"));
  const blocked = $derived((tasks ?? []).filter((task) => task.status === "blocked"));
  const ranked = $derived(suggestions(tasks ?? []));
  const pick = $derived(ranked.find((s) => !skipped.includes(s.task.id)) ?? null);
  const defaultPipe = $derived(app.sidebar.mine.find((p) => p.isDefault));

  async function run(fn: () => Promise<unknown>, success?: string) {
    busy = true;
    try {
      await fn();
      if (success) app.toast(success);
      app.refresh();
    } catch (err) {
      app.toast(errorMessage(err), "error");
    } finally {
      busy = false;
    }
  }

  function start(task: Task) {
    const c = columnWith(task, "started", "ongoing");
    if (c) run(() => api.patch(`/tasks/${task.id}`, { stage: c.id }), t("Off you go: “{title}”", { title: task.title }));
  }

  function finish(task: Task) {
    const c = columnWith(task, "done");
    if (c) run(() => api.patch(`/tasks/${task.id}`, { stage: c.id }), t("“{title}” done", { title: task.title }));
  }

  function checkNext(task: Task) {
    const item = task.checklist.next;
    if (item) run(() => api.patch(`/items/${item.id}`, { done: true }), t("“{item}” checked", { item: item.text }));
  }

  // Once every suggestion was skipped, start over.
  function another() {
    skipped = ranked.length && ranked.every((s) => [...skipped, pick?.task.id].includes(s.task.id)) ? [] : [...skipped, pick!.task.id];
  }

  async function capt(e: SubmitEvent) {
    e.preventDefault();
    const title = capture.trim();
    if (!title || !defaultPipe) return;
    await run(() => api.post("/tasks", { pipeId: defaultPipe.id, title }), t("Noted in {pipe}", { pipe: defaultPipe.name }));
    capture = "";
  }

  const location = (task: Task) => `${task.space.kind === "team" ? `${task.space.name} › ` : ""}${task.pipe?.name ?? ""}`;
</script>

<div class="page narrow">
  <div class="page-header">
    <div class="grow">
      <h1><Icon name="target" size={26} />{t("Next action")}</h1>
      <div class="subtitle">{t("One thing at a time: capture, finish what is in progress, then start the next one.")}</div>
    </div>
    <a class="btn neutral" href="/tasks"><Icon name="checklist" size={18} />{t("All my tasks")}</a>
  </div>

  {#if defaultPipe}
    <form class="capture" onsubmit={capt}>
      <Icon name="inbox" size={18} />
      <input placeholder={t("An idea, something to do? Note it, it will go to “{pipe}”…", { pipe: defaultPipe.name })} bind:value={capture} maxlength="300" />
      <button class="btn small" disabled={busy || !capture.trim()}>{t("Note")}</button>
    </form>
  {/if}

  {#if !tasks}
    <div class="muted">{t("Loading…")}</div>
  {:else}
    {#if doing.length >= WIP_LIMIT}
      <div class="callout warning">
        <Icon name="bolt" />
        <span>{t("You already have {n} tasks in progress. How about finishing one before starting another?", { n: doing.length })}</span>
      </div>
    {/if}

    <div class="section">
      <div class="section-title"><Icon name="play" />{t("What now?")}</div>
      {#if pick}
        {@const task = pick.task}
        {@const type = task.taskType !== "task" ? app.taskType(task.taskType) : undefined}
        <div class="suggestion card">
          <div class="s-loc small muted">
            {#if type}<span class="row" style="gap:4px"><Icon name={iconOf(type.icon)} size={14} />{type.label}</span> ·{/if}
            {location(task)} · {app.columnOf(task)?.label}
          </div>
          <button class="s-title" onclick={() => app.openTask(task.id)}>{task.title}</button>
          {#if pick.reasons.length || task.dueDate}
            <div class="reasons">
              {#if task.dueDate}<span class="chip due {dueState(task.dueDate, task.status)}"><Icon name="calendar" size={13} />{formatDate(task.dueDate)}</span>{/if}
              {#each pick.reasons as r (r)}<span class="chip">{r}</span>{/each}
            </div>
          {/if}
          {#if task.checklist.next}
            <div class="small next-item"><Icon name="checklist" size={14} />{t("First step:")} <strong>{task.checklist.next.text}</strong></div>
          {/if}
          <div class="row wrap actions">
            <button class="btn" disabled={busy} onclick={() => start(task)}><Icon name="play" size={16} />{t("Start")}</button>
            {#if ranked.length > 1}
              <button class="btn neutral" disabled={busy} onclick={another}><Icon name="skip" size={16} />{t("Another suggestion")}</button>
            {/if}
            <button class="btn ghost" onclick={() => app.openTask(task.id)}>{t("Open task")}</button>
          </div>
        </div>
      {:else}
        <div class="empty">
          {t("No ready or upcoming task to start.")}
          {#if doing.length}{t("Focus on the ones in progress!")}{:else}{t("Note whatever comes to mind above.")}{/if}
        </div>
      {/if}
    </div>

    <div class="section">
      <div class="section-title"><Icon name="bolt" />{t("In progress")}<span class="count neutral">{doing.length}</span></div>
      {#each doing as task (task.id)}
        <div class="doing card">
          <div class="d-main">
            <button class="d-title" onclick={() => app.openTask(task.id)}>{task.title}</button>
            <div class="small muted">
              {location(task)} · {app.columnOf(task)?.label}
              {#if task.dueDate} · <span class="due {dueState(task.dueDate, task.status)}">{formatDate(task.dueDate)}</span>{/if}
              {#if task.checklist.total} · {t("{done}/{total} sub-tasks", { done: task.checklist.done, total: task.checklist.total })}{/if}
            </div>
            {#if task.checklist.next}
              <label class="next-check">
                <input type="checkbox" disabled={busy} onchange={() => checkNext(task)} />
                <span>{task.checklist.next.text}</span>
              </label>
            {/if}
          </div>
          {#if columnWith(task, "done")}
            <button class="btn neutral small" disabled={busy} onclick={() => finish(task)}><Icon name="check" size={16} />{t("Finish")}</button>
          {/if}
        </div>
      {:else}
        <div class="small muted">{t("Nothing in progress.")}</div>
      {/each}
    </div>

    {#if blocked.length}
      <div class="section">
        <div class="section-title"><Icon name="flag" />{t("Blocked: chase them up?")}<span class="count neutral">{blocked.length}</span></div>
        <div class="list">{#each blocked as task (task.id)}<TaskRow task={task} />{/each}</div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .narrow { max-width: 820px; }
  .capture {
    display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px; border: 1px solid var(--input-border);
    border-radius: 10px; color: var(--text-tertiary);
  }
  .capture:focus-within { border-color: var(--input-border-focused); }
  .capture input { flex: 1; min-width: 0; border: 0; outline: none; background: none; font: inherit; font-size: 15px; color: var(--text); }
  .section { margin-top: 28px; }
  .suggestion { padding: 20px 22px; box-shadow: var(--card-shadow), inset 4px 0 0 var(--accent); }
  .s-loc { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .s-title, .d-title {
    display: block; border: 0; background: none; padding: 0; font: inherit; color: var(--text); text-align: left; cursor: pointer;
  }
  .s-title { font-size: 22px; font-weight: 600; margin: 6px 0 10px; line-height: 1.3; }
  .d-title { font-weight: 500; font-size: 15px; }
  .s-title:hover, .d-title:hover { text-decoration: underline; }
  .reasons { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 8px; border-radius: 10px; background: var(--background-secondary); color: var(--text-secondary); }
  .next-item { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); margin-bottom: 12px; }
  .actions { margin-top: 6px; }
  .doing { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
  .d-main { flex: 1; min-width: 0; }
  .next-check { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 14px; cursor: pointer; }
  .next-check input { width: 16px; height: 16px; margin: 0; accent-color: #3ad984; }
</style>
