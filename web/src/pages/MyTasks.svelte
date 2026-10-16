<script lang="ts">
  import { api } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { GROUPS } from "../lib/gtd";
  import type { Task } from "../lib/types";
  import TaskRow from "../components/TaskRow.svelte";
  import Icon from "../components/Icon.svelte";

  let tasks = $state<Task[] | null>(null);
  let filter = $state("");

  const read = () => { try { return localStorage.getItem("tp:myTasksBy") === "pipe" ? "pipe" : "state"; } catch { return "state"; } };
  let by = $state<"state" | "pipe">(read());
  function setBy(v: "state" | "pipe") {
    by = v;
    try { localStorage.setItem("tp:myTasksBy", v); } catch { /* storage unavailable */ }
  }

  $effect(() => {
    app.version;
    api.get<Task[]>("/me/tasks").then((d) => (tasks = d));
  });

  const shown = $derived(
    (tasks ?? []).filter((t) => {
      const q = filter.trim().toLowerCase();
      return !q || `${t.title} ${t.pipe?.name} ${t.space.name}`.toLowerCase().includes(q);
    })
  );

  const groups = $derived.by(() => {
    if (by === "state") {
      return GROUPS.map((g) => ({ id: g.id, label: g.label, hint: g.hint, tasks: shown.filter((t) => g.statuses.includes(t.status)) }));
    }
    const map = new Map<string, { id: string; label: string; hint: string; tasks: Task[] }>();
    for (const t of shown) {
      const id = t.pipe!.id;
      if (!map.has(id)) map.set(id, { id, label: t.pipe!.name, hint: t.space.kind === "team" ? t.space.name : "", tasks: [] });
      map.get(id)!.tasks.push(t);
    }
    return [...map.values()];
  });
</script>

<div class="page">
  <div class="page-header">
    <div class="grow">
      <h1><Icon name="checklist" size={26} />Mes tâches</h1>
      <div class="subtitle">Tout ce qui vous est attribué et reste à faire, tous pipes confondus.</div>
    </div>
    <a class="btn neutral" href="/next"><Icon name="target" size={18} />Prochaine action</a>
  </div>

  <div class="toolbar">
    <input class="input" placeholder="Filtrer…" bind:value={filter} />
    <div class="seg" role="group" aria-label="Regrouper">
      <button class:active={by === "state"} onclick={() => setBy("state")}>Par état</button>
      <button class:active={by === "pipe"} onclick={() => setBy("pipe")}>Par pipe</button>
    </div>
  </div>

  {#if !tasks}
    <div class="muted">Chargement…</div>
  {:else if !tasks.length}
    <div class="empty">Rien à faire pour l'instant. Profitez-en !</div>
  {:else}
    {#each groups.filter((g) => g.tasks.length || by === "state") as g (g.id)}
      <div class="section">
        <div class="section-title">
          {g.label}<span class="count neutral">{g.tasks.length}</span>
          {#if g.hint}<span class="small muted hint-inline">{g.hint}</span>{/if}
        </div>
        {#if g.tasks.length}
          <div class="list">{#each g.tasks as t (t.id)}<TaskRow task={t} showLocation={by === "state"} />{/each}</div>
        {:else}
          <div class="small muted">Aucune.</div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .toolbar { display: flex; gap: 12px; align-items: center; }
  .toolbar .input { max-width: 320px; }
  .seg { display: inline-flex; border: 1px solid var(--input-border); border-radius: 6px; overflow: hidden; }
  .seg button { border: 0; background: none; color: var(--text-secondary); font: inherit; font-size: 13px; padding: 6px 12px; cursor: pointer; }
  .seg button.active { background: var(--background-secondary); color: var(--text); font-weight: 500; }
  .hint-inline { font-weight: 400; }
  .section { margin-top: 24px; }
</style>
