<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { router, setParams } from "../lib/router.svelte";
  import { FIELD_TYPE_LABELS } from "../lib/constants";
  import type { PipeType, TaskType } from "../lib/types";
  import Icon, { iconOf } from "../components/Icon.svelte";
  import PipeIcon from "../components/PipeIcon.svelte";
  import PipeTypeEditor from "../components/PipeTypeEditor.svelte";
  import TaskTypeEditor from "../components/TaskTypeEditor.svelte";

  const tab = $derived(router.params.get("tab") === "tasks" ? "tasks" : "pipes");

  let usage = $state<{ pipeTypes: Record<string, number>; taskTypes: Record<string, number> }>({ pipeTypes: {}, taskTypes: {} });
  const loadUsage = () => api.get<typeof usage>("/catalog/usage").then((u) => (usage = u)).catch(() => {});
  $effect(() => {
    app.version;
    loadUsage();
    app.loadCatalog().catch(() => {});
  });

  let pipeEditor = $state<{ editing?: PipeType; base?: PipeType } | null>(null);
  let taskEditor = $state<{ editing?: TaskType; base?: TaskType } | null>(null);

  const mine = (t: { custom?: true; createdBy?: { id: string } | null }) => t.custom && t.createdBy?.id === app.me?.user.id;
  // Built-in types, public ones, and my private ones; by category.
  const pipeTypes = $derived(app.pipeTypes.filter((t) => app.usable(t)));
  const groups = $derived([...new Set(pipeTypes.map((t) => t.group))]);
  const taskTypes = $derived(app.taskTypes.filter((t) => app.usable(t)));
  const taskGroups = $derived([...new Set(taskTypes.map((t) => app.taskTypeGroup(t)))]);
  const offeredIn = (id: string) => app.pipeTypes.filter((p) => p.taskTypes.includes(id)).map((p) => p.label);

  async function remove(kind: "pipe-types" | "task-types", t: PipeType | TaskType) {
    if (!confirm(`Supprimer le type « ${t.label} » ?`)) return;
    try {
      await api.del(`/catalog/${kind}/${t.id}`);
      app.toast("Type supprimé");
      await app.loadCatalog();
      loadUsage();
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
  }
</script>

{#snippet owner(t: PipeType | TaskType)}
  {#if t.custom}
    {#if t.visibility === "private"}<span class="badge" title="Visible de vous seul·e"><Icon name="lock" size={12} />Privé</span>{/if}
    <span class="badge">{mine(t) ? (t.visibility === "private" ? "Mon modèle" : "Mon modèle · public") : `par ${t.createdBy?.name ?? "?"}`}</span>
  {:else}
    <span class="badge">Intégré</span>
  {/if}
{/snippet}

<div class="page">
  <div class="page-header">
    <div class="grow">
      <h1><Icon name="clipboard" size={26} />Modèles</h1>
      <div class="subtitle">
        Concevez vos types de pipes (colonnes, types de tâches, confidentialité) et vos types de tâches (champs),
        en partant de zéro ou d'un modèle existant.
      </div>
    </div>
    {#if tab === "pipes"}
      <button class="btn" onclick={() => (pipeEditor = {})}><Icon name="plus" size={18} />Nouveau type de pipe</button>
    {:else}
      <button class="btn" onclick={() => (taskEditor = {})}><Icon name="plus" size={18} />Nouveau type de tâche</button>
    {/if}
  </div>

  <div class="tabs">
    <button class:active={tab === "pipes"} onclick={() => setParams({ tab: null })}>Types de pipes</button>
    <button class:active={tab === "tasks"} onclick={() => setParams({ tab: "tasks" })}>Types de tâches</button>
  </div>

  {#if tab === "pipes"}
    {#each groups as g (g)}
      <div class="section">
        <div class="section-title">{g}</div>
        <div class="grid">
          {#each pipeTypes.filter((t) => t.group === g) as t (t.id)}
            <div class="card type-card">
              <div class="row head">
                <PipeIcon pipe={{ icon: t.icon, kind: t.id, color: t.color }} size={22} />
                <strong class="grow">{t.label}</strong>
                {@render owner(t)}
              </div>
              <div class="small muted desc">{t.description}</div>
              <div class="cols">
                {#each t.columns as c (c.id)}<span class="col"><span class="status-dot" style="background:{c.color}"></span>{c.label}</span>{/each}
              </div>
              <div class="small muted">
                {usage.pipeTypes[t.id] ?? 0} pipe{(usage.pipeTypes[t.id] ?? 0) > 1 ? "s" : ""}
                {#if t.taskTypes.length} · {t.taskTypes.length} type{t.taskTypes.length > 1 ? "s" : ""} de tâches{/if}
                {#if t.teamOnly} · <Icon name="lock" size={12} /> réservé à une équipe{:else if t.confidential} · <Icon name="lock" size={12} /> confidentiel{/if}
              </div>
              <div class="row actions">
                <button class="btn ghost small" onclick={() => (pipeEditor = { base: t })}>Dupliquer</button>
                {#if mine(t)}
                  <button class="btn ghost small" onclick={() => (pipeEditor = { editing: t })}><Icon name="edit" size={14} />Modifier</button>
                  <button class="btn ghost small" disabled={Boolean(usage.pipeTypes[t.id])}
                    title={usage.pipeTypes[t.id] ? "Des pipes utilisent ce type" : undefined}
                    onclick={() => remove("pipe-types", t)}><Icon name="trash" size={14} />Supprimer</button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  {:else}
    {#each taskGroups as g (g)}
    <div class="section">
      <div class="section-title">{g}</div>
      <div class="grid">
        {#each taskTypes.filter((t) => app.taskTypeGroup(t) === g) as t (t.id)}
          <div class="card type-card">
            <div class="row head">
              <Icon name={iconOf(t.icon)} />
              <strong class="grow">{t.label}</strong>
              {@render owner(t)}
            </div>
            <div class="small muted desc">{t.description}</div>
            {#if t.fields.length}
              <div class="cols">
                {#each t.fields.slice(0, 8) as f (f.id)}<span class="col" title={FIELD_TYPE_LABELS[f.type]}>{f.label}</span>{/each}
                {#if t.fields.length > 8}<span class="col">+{t.fields.length - 8}</span>{/if}
              </div>
            {/if}
            <div class="small muted">
              {usage.taskTypes[t.id] ?? 0} tâche{(usage.taskTypes[t.id] ?? 0) > 1 ? "s" : ""}
              {#if offeredIn(t.id).length} · dans {offeredIn(t.id).join(", ")}{/if}
            </div>
            <div class="row actions">
              <button class="btn ghost small" onclick={() => (taskEditor = { base: t })}>Dupliquer</button>
              {#if mine(t)}
                <button class="btn ghost small" onclick={() => (taskEditor = { editing: t })}><Icon name="edit" size={14} />Modifier</button>
                <button class="btn ghost small" disabled={Boolean(usage.taskTypes[t.id])} onclick={() => remove("task-types", t)}>
                  <Icon name="trash" size={14} />Supprimer
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
    {/each}
    <div class="section">
      <div class="hint">Un type de tâche s'utilise dans les pipes dont le type le propose : ajoutez-le à un type de pipe.</div>
    </div>
  {/if}
</div>

{#if pipeEditor}
  <PipeTypeEditor editing={pipeEditor.editing} base={pipeEditor.base} onclose={() => (pipeEditor = null)} onsaved={loadUsage} />
{/if}
{#if taskEditor}
  <TaskTypeEditor editing={taskEditor.editing} base={taskEditor.base} onclose={() => (taskEditor = null)} onsaved={loadUsage} />
{/if}

<style>
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--divider); }
  .tabs button {
    border: 0; background: none; font: inherit; font-size: 14px; font-weight: 500; color: var(--text-tertiary);
    padding: 8px 12px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .tabs button.active { color: var(--text); border-bottom-color: var(--text); }
  .section { margin-top: 24px; }
  .type-card { display: flex; flex-direction: column; gap: 8px; }
  .head strong { font-size: 15px; }
  .grow { flex: 1; min-width: 0; }
  .desc { line-height: 1.4; }
  .cols { display: flex; flex-wrap: wrap; gap: 4px; }
  .col { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; background: var(--background-secondary); border-radius: 10px; padding: 1px 8px; color: var(--text-secondary); }
  .actions { margin-top: auto; gap: 2px; margin-left: -8px; }
  .small :global(svg) { vertical-align: -2px; }
</style>
