<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { dueState, formatDate } from "../lib/constants";
  import { columnWith, suggestions } from "../lib/gtd";
  import type { Task } from "../lib/types";
  import Icon, { iconOf } from "../components/Icon.svelte";
  import TaskRow from "../components/TaskRow.svelte";

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

  const doing = $derived((tasks ?? []).filter((t) => t.status === "started" || t.status === "ongoing"));
  const blocked = $derived((tasks ?? []).filter((t) => t.status === "blocked"));
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

  function start(t: Task) {
    const c = columnWith(t, "started", "ongoing");
    if (c) run(() => api.patch(`/tasks/${t.id}`, { stage: c.id }), `C'est parti : « ${t.title} »`);
  }

  function finish(t: Task) {
    const c = columnWith(t, "done");
    if (c) run(() => api.patch(`/tasks/${t.id}`, { stage: c.id }), `« ${t.title} » terminée`);
  }

  function checkNext(t: Task) {
    const item = t.checklist.next;
    if (item) run(() => api.patch(`/items/${item.id}`, { done: true }), `« ${item.text} » cochée`);
  }

  // Once every suggestion was skipped, start over.
  function another() {
    skipped = ranked.length && ranked.every((s) => [...skipped, pick?.task.id].includes(s.task.id)) ? [] : [...skipped, pick!.task.id];
  }

  async function capt(e: SubmitEvent) {
    e.preventDefault();
    const title = capture.trim();
    if (!title || !defaultPipe) return;
    await run(() => api.post("/tasks", { pipeId: defaultPipe.id, title }), `Notée dans ${defaultPipe.name}`);
    capture = "";
  }

  const location = (t: Task) => `${t.space.kind === "team" ? `${t.space.name} › ` : ""}${t.pipe?.name ?? ""}`;
</script>

<div class="page narrow">
  <div class="page-header">
    <div class="grow">
      <h1><Icon name="target" size={26} />Prochaine action</h1>
      <div class="subtitle">Une chose à la fois : on capture, on termine ce qui est en cours, puis on démarre la suivante.</div>
    </div>
    <a class="btn neutral" href="/tasks"><Icon name="checklist" size={18} />Toutes mes tâches</a>
  </div>

  {#if defaultPipe}
    <form class="capture" onsubmit={capt}>
      <Icon name="inbox" size={18} />
      <input placeholder={`Une idée, un truc à faire ? Notez-le, il ira dans « ${defaultPipe.name} »…`} bind:value={capture} maxlength="300" />
      <button class="btn small" disabled={busy || !capture.trim()}>Noter</button>
    </form>
  {/if}

  {#if !tasks}
    <div class="muted">Chargement…</div>
  {:else}
    {#if doing.length >= WIP_LIMIT}
      <div class="callout warning">
        <Icon name="bolt" />
        <span>Vous avez déjà <strong>{doing.length} tâches en cours</strong>. Et si vous en terminiez une avant d'en démarrer une autre ?</span>
      </div>
    {/if}

    <div class="section">
      <div class="section-title"><Icon name="play" />Et maintenant ?</div>
      {#if pick}
        {@const t = pick.task}
        {@const type = t.taskType !== "task" ? app.taskType(t.taskType) : undefined}
        <div class="suggestion card">
          <div class="s-loc small muted">
            {#if type}<span class="row" style="gap:4px"><Icon name={iconOf(type.icon)} size={14} />{type.label}</span> ·{/if}
            {location(t)} · {app.columnOf(t)?.label}
          </div>
          <button class="s-title" onclick={() => app.openTask(t.id)}>{t.title}</button>
          {#if pick.reasons.length || t.dueDate}
            <div class="reasons">
              {#if t.dueDate}<span class="chip due {dueState(t.dueDate, t.status)}"><Icon name="calendar" size={13} />{formatDate(t.dueDate)}</span>{/if}
              {#each pick.reasons as r (r)}<span class="chip">{r}</span>{/each}
            </div>
          {/if}
          {#if t.checklist.next}
            <div class="small next-item"><Icon name="checklist" size={14} />Première étape : <strong>{t.checklist.next.text}</strong></div>
          {/if}
          <div class="row wrap actions">
            <button class="btn" disabled={busy} onclick={() => start(t)}><Icon name="play" size={16} />Démarrer</button>
            {#if ranked.length > 1}
              <button class="btn neutral" disabled={busy} onclick={another}><Icon name="skip" size={16} />Autre suggestion</button>
            {/if}
            <button class="btn ghost" onclick={() => app.openTask(t.id)}>Ouvrir</button>
          </div>
        </div>
      {:else}
        <div class="empty">
          Aucune tâche prête ou à venir à démarrer.
          {#if doing.length}Concentrez-vous sur celles en cours !{:else}Notez ce qui vous passe par la tête ci-dessus.{/if}
        </div>
      {/if}
    </div>

    <div class="section">
      <div class="section-title"><Icon name="bolt" />En cours<span class="count neutral">{doing.length}</span></div>
      {#each doing as t (t.id)}
        <div class="doing card">
          <div class="d-main">
            <button class="d-title" onclick={() => app.openTask(t.id)}>{t.title}</button>
            <div class="small muted">
              {location(t)} · {app.columnOf(t)?.label}
              {#if t.dueDate} · <span class="due {dueState(t.dueDate, t.status)}">{formatDate(t.dueDate)}</span>{/if}
              {#if t.checklist.total} · {t.checklist.done}/{t.checklist.total} sous-tâches{/if}
            </div>
            {#if t.checklist.next}
              <label class="next-check">
                <input type="checkbox" disabled={busy} onchange={() => checkNext(t)} />
                <span>{t.checklist.next.text}</span>
              </label>
            {/if}
          </div>
          {#if columnWith(t, "done")}
            <button class="btn neutral small" disabled={busy} onclick={() => finish(t)}><Icon name="check" size={16} />Terminer</button>
          {/if}
        </div>
      {:else}
        <div class="small muted">Rien en cours.</div>
      {/each}
    </div>

    {#if blocked.length}
      <div class="section">
        <div class="section-title"><Icon name="flag" />Bloquées : à relancer ?<span class="count neutral">{blocked.length}</span></div>
        <div class="list">{#each blocked as t (t.id)}<TaskRow task={t} />{/each}</div>
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
