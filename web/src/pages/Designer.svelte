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
  import { t, tn } from "../lib/i18n.svelte";

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

  const mine = (ty: { custom?: true; createdBy?: { id: string } | null }) => ty.custom && ty.createdBy?.id === app.me?.user.id;
  // Built-in types, public ones, and my private ones; by category.
  const pipeTypes = $derived(app.pipeTypes.filter((ty) => app.usable(ty)));
  const groups = $derived([...new Set(pipeTypes.map((ty) => ty.group))]);
  const taskTypes = $derived(app.taskTypes.filter((ty) => app.usable(ty)));
  const taskGroups = $derived([...new Set(taskTypes.map((ty) => app.taskTypeGroup(ty)))]);
  const offeredIn = (id: string) => app.pipeTypes.filter((p) => p.taskTypes.includes(id)).map((p) => p.label);

  async function remove(kind: "pipe-types" | "task-types", ty: PipeType | TaskType) {
    if (!confirm(t("Delete the type “{name}”?", { name: ty.label }))) return;
    try {
      await api.del(`/catalog/${kind}/${ty.id}`);
      app.toast(t("Type deleted"));
      await app.loadCatalog();
      loadUsage();
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
  }
</script>

{#snippet owner(ty: PipeType | TaskType)}
  {#if ty.custom}
    {#if ty.visibility === "private"}<span class="badge" title={t("Only you see it")}><Icon name="lock" size={12} />{t("Private")}</span>{/if}
    <span class="badge">{mine(ty) ? (ty.visibility === "private" ? t("My model") : t("My model · public")) : t("by {name}", { name: ty.createdBy?.name ?? "?" })}</span>
  {:else}
    <span class="badge">{t("Built-in")}</span>
  {/if}
{/snippet}

<div class="page">
  <div class="page-header">
    <div class="grow">
      <h1><Icon name="clipboard" size={26} />{t("Models")}</h1>
      <div class="subtitle">
        {t("Design your pipe types (columns, task types, confidentiality) and your task types (fields), from scratch or from an existing model.")}
      </div>
    </div>
    {#if tab === "pipes"}
      <button class="btn" onclick={() => (pipeEditor = {})}><Icon name="plus" size={18} />{t("New pipe type")}</button>
    {:else}
      <button class="btn" onclick={() => (taskEditor = {})}><Icon name="plus" size={18} />{t("New task type")}</button>
    {/if}
  </div>

  <div class="tabs">
    <button class:active={tab === "pipes"} onclick={() => setParams({ tab: null })}>{t("Pipe types")}</button>
    <button class:active={tab === "tasks"} onclick={() => setParams({ tab: "tasks" })}>{t("Task types")}</button>
  </div>

  {#if tab === "pipes"}
    {#each groups as g (g)}
      <div class="section">
        <div class="section-title">{g}</div>
        <div class="grid">
          {#each pipeTypes.filter((ty) => ty.group === g) as ty (ty.id)}
            <div class="card type-card">
              <div class="row head">
                <PipeIcon pipe={{ icon: ty.icon, kind: ty.id, color: ty.color }} size={22} />
                <strong class="grow">{ty.label}</strong>
                {@render owner(ty)}
              </div>
              <div class="small muted desc">{ty.description}</div>
              <div class="cols">
                {#each ty.columns as c (c.id)}<span class="col"><span class="status-dot" style="background:{c.color}"></span>{c.label}</span>{/each}
              </div>
              <div class="small muted">
                {tn(usage.pipeTypes[ty.id] ?? 0, "{n} pipe", "{n} pipes")}
                {#if ty.taskTypes.length} · {tn(ty.taskTypes.length, "{n} task type", "{n} task types")}{/if}
                {#if ty.teamOnly} · <Icon name="lock" size={12} /> {t("reserved to a team")}{:else if ty.confidential} · <Icon name="lock" size={12} /> {t("confidential")}{/if}
              </div>
              <div class="row actions">
                <button class="btn ghost small" onclick={() => (pipeEditor = { base: ty })}>{t("Duplicate")}</button>
                {#if mine(ty)}
                  <button class="btn ghost small" onclick={() => (pipeEditor = { editing: ty })}><Icon name="edit" size={14} />{t("Edit")}</button>
                  <button class="btn ghost small" disabled={Boolean(usage.pipeTypes[ty.id])}
                    title={usage.pipeTypes[ty.id] ? t("Pipes use this type") : undefined}
                    onclick={() => remove("pipe-types", ty)}><Icon name="trash" size={14} />{t("Delete")}</button>
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
        {#each taskTypes.filter((ty) => app.taskTypeGroup(ty) === g) as ty (ty.id)}
          <div class="card type-card">
            <div class="row head">
              <Icon name={iconOf(ty.icon)} />
              <strong class="grow">{ty.label}</strong>
              {@render owner(ty)}
            </div>
            <div class="small muted desc">{ty.description}</div>
            {#if ty.fields.length}
              <div class="cols">
                {#each ty.fields.slice(0, 8) as f (f.id)}<span class="col" title={t(FIELD_TYPE_LABELS[f.type])}>{f.label}</span>{/each}
                {#if ty.fields.length > 8}<span class="col">+{ty.fields.length - 8}</span>{/if}
              </div>
            {/if}
            <div class="small muted">
              {tn(usage.taskTypes[ty.id] ?? 0, "{n} task", "{n} tasks")}
              {#if offeredIn(ty.id).length} · {t("in {types}", { types: offeredIn(ty.id).join(", ") })}{/if}
            </div>
            <div class="row actions">
              <button class="btn ghost small" onclick={() => (taskEditor = { base: ty })}>{t("Duplicate")}</button>
              {#if mine(ty)}
                <button class="btn ghost small" onclick={() => (taskEditor = { editing: ty })}><Icon name="edit" size={14} />{t("Edit")}</button>
                <button class="btn ghost small" disabled={Boolean(usage.taskTypes[ty.id])} onclick={() => remove("task-types", ty)}>
                  <Icon name="trash" size={14} />{t("Delete")}
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
    {/each}
    <div class="section">
      <div class="hint">{t("A task type is used in the pipes whose type offers it: add it to a pipe type.")}</div>
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
