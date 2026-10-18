<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { dependencyLabel } from "../lib/dependencies";
  import type { Dependency, SearchResult, TaskDetail } from "../lib/types";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";

  let { task, onchange }: { task: TaskDetail; onchange: () => void } = $props();

  const canEdit = $derived(task.permissions.editContent);
  let adding = $state(false);
  let q = $state("");
  let results = $state<SearchResult[]>([]);
  let error = $state("");
  let busy = $state(false);

  // Tasks one can open, found as one types; not this one, nor those already awaited.
  let seq = 0;
  $effect(() => {
    const text = q.trim();
    const n = ++seq;
    if (!text) {
      results = [];
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const found = await api.get<SearchResult[]>(`/search?${new URLSearchParams({ q: text })}`);
        if (n !== seq) return;
        const linked = new Set(task.blockedBy.map((d) => d.id));
        results = found.filter((r) => r.id !== task.id && !linked.has(r.id)).slice(0, 8);
      } catch (err) {
        if (n === seq) error = errorMessage(err);
      }
    }, 200);
    return () => clearTimeout(timer);
  });

  async function change(fn: () => Promise<unknown>) {
    busy = true;
    error = "";
    try {
      await fn();
      onchange();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  const add = (r: SearchResult) =>
    change(async () => {
      await api.post(`/tasks/${task.id}/dependencies`, { blockerId: r.id });
      q = "";
      adding = false;
    });
  const remove = (d: Dependency) => change(() => api.del(`/tasks/${task.id}/dependencies/${d.id}`));
</script>

{#snippet item(d: Dependency, removable: boolean)}
  <li class:resolved={d.resolved}>
    <Icon name={d.resolved ? "check" : "link"} size={14} />
    {#if d.visible}
      <button class="link-btn" onclick={() => app.openTask(d.id!)}>{dependencyLabel(d)}</button>
    {:else}
      <span class="muted" title={t("You cannot open this task")}>{dependencyLabel(d)}</span>
    {/if}
    {#if d.owner}<span class="muted small">· {d.owner.name}</span>{/if}
    {#if d.resolved}<span class="muted small">· {t("finished")}</span>{/if}
    {#if removable && canEdit && d.id}
      <button class="btn ghost icon small" title={t("Stop waiting for it")} disabled={busy} onclick={() => remove(d)}><Icon name="unlink" size={14} /></button>
    {/if}
  </li>
{/snippet}

{#if task.blockedBy.length || task.blocks.length || canEdit}
  <div class="infos">
    <div class="section-title"><Icon name="link" />{t("Dependencies")}</div>
    {#if task.blockers}
      <p class="callout warning small">{t("Blocked: it waits for tasks still to finish.")}</p>
    {/if}
    {#if task.blockedBy.length || canEdit}
      <div class="label-text">{t("Waits for")}</div>
      <ul class="deps">{#each task.blockedBy as d, i (d.id ?? i)}{@render item(d, true)}{/each}</ul>
      {#if canEdit}
        {#if adding}
          <input class="input" bind:value={q} placeholder={t("Search a task…")} aria-label={t("Search a task…")} />
          {#if results.length}
            <ul class="results">
              {#each results as r (r.id)}
                <li><button class="link-btn" disabled={busy} onclick={() => add(r)}>#{r.number} {r.title}</button>
                  {#if r.owner}<span class="muted small">· {r.owner.name}</span>{/if}</li>
              {/each}
            </ul>
          {/if}
          <button class="btn ghost small" onclick={() => { adding = false; q = ""; }}>{t("Cancel")}</button>
        {:else}
          <button class="btn neutral small" onclick={() => (adding = true)}>{t("Add a task it waits for")}</button>
        {/if}
      {/if}
    {/if}
    {#if task.blocks.length}
      <div class="label-text">{t("Blocks")}</div>
      <ul class="deps">{#each task.blocks as d, i (d.id ?? i)}{@render item(d, false)}{/each}</ul>
    {/if}
    {#if error}<p class="error-text">{error}</p>{/if}
  </div>
{/if}

<style>
  .infos { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--divider); }
  .label-text { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); margin-top: 8px; }
  .deps, .results { list-style: none; margin: 4px 0 8px; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
  .deps li, .results li { display: flex; align-items: center; gap: 6px; }
  .resolved .link-btn, .resolved > .muted:first-of-type { text-decoration: line-through; }
  .link-btn { background: none; border: 0; padding: 0; font: inherit; color: var(--link, #0366d6); cursor: pointer; text-align: left; }
  .results { margin-top: 6px; }
</style>
