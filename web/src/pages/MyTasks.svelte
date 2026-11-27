<script lang="ts">
  import { api } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { GROUPS } from "../lib/gtd";
  import { PRIORITIES, distinctLabels, matches } from "../lib/labels";
  import type { Task } from "../lib/types";
  import TaskRow from "../components/TaskRow.svelte";
  import Icon from "../components/Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import { router, setParams } from "../lib/router.svelte";

  let tasks = $state<Task[] | null>(null);
  let filter = $state("");

  let labelFilter = $state("");
  let priorityFilter = $state("");

  type By = "state" | "pipe" | "priority";
  const read = (): By => {
    try {
      const v = localStorage.getItem("tp:myTasksBy");
      return v === "pipe" || v === "priority" ? v : "state";
    } catch {
      return "state";
    }
  };
  let by = $state<By>(read());
  function setBy(v: By) {
    by = v;
    try { localStorage.setItem("tp:myTasksBy", v); } catch { /* storage unavailable */ }
  }

  // Someone else's tasks (?user=…): what they still have to do, among the tasks one sees oneself.
  const userId = $derived(router.params.get("user"));
  // A teammate one is not connected with is not in the people list: shown without a name.
  const person = $derived(
    userId && userId !== app.me?.user.id ? (app.users.find((u) => u.id === userId) ?? { id: userId, name: t("this person") }) : null
  );
  const others = $derived(app.users.filter((u) => u.id !== app.me?.user.id));
  let failed = $state(false);

  $effect(() => {
    app.version;
    const id = userId && userId !== app.me?.user.id ? userId : null;
    tasks = null;
    failed = false;
    api.get<Task[]>(id ? `/users/${id}/tasks` : "/me/tasks").then((d) => (tasks = d)).catch(() => ((failed = true), (tasks = [])));
  });

  const shown = $derived(
    (tasks ?? []).filter((task) => {
      const q = filter.trim().toLowerCase();
      return (!q || `${task.title} ${task.pipe?.name} ${task.space.name}`.toLowerCase().includes(q)) &&
        matches(task, { labels: labelFilter ? [labelFilter] : [], priority: priorityFilter === "" ? undefined : (Number(priorityFilter) as 0) });
    })
  );
  const labelChoices = $derived(distinctLabels((tasks ?? []).flatMap((x) => x.labels)));

  const groups = $derived.by(() => {
    if (by === "state") {
      return GROUPS.map((g) => ({ id: g.id, label: t(g.label), hint: t(g.hint), tasks: shown.filter((task) => g.statuses.includes(task.status)) }));
    }
    if (by === "priority") {
      return [...PRIORITIES.map((p) => ({ id: String(p.value), label: t(p.label), hint: "", tasks: shown.filter((task) => task.priority === p.value) })),
        { id: "none", label: t("No priority"), hint: "", tasks: shown.filter((task) => !task.priority) }];
    }
    const map = new Map<string, { id: string; label: string; hint: string; tasks: Task[] }>();
    for (const task of shown) {
      const id = task.pipe!.id;
      if (!map.has(id)) map.set(id, { id, label: task.pipe!.name, hint: task.space.kind === "team" ? task.space.name : "", tasks: [] });
      map.get(id)!.tasks.push(task);
    }
    return [...map.values()];
  });
</script>

<div class="page">
  <div class="page-header">
    <div class="grow">
      {#if person}
        <h1><Icon name="checklist" size={26} />{t("Tasks of {name}", { name: person.name })}</h1>
        <div class="subtitle">{t("Everything assigned to {name} and still to do, among the tasks you can see.", { name: person.name })}</div>
      {:else}
        <h1><Icon name="checklist" size={26} />{t("My tasks")}</h1>
        <div class="subtitle">{t("Everything assigned to you and still to do, across all pipes.")}</div>
      {/if}
    </div>
    {#if !person}<a class="btn neutral" href="/next"><Icon name="target" size={18} />{t("Next action")}</a>{/if}
  </div>

  <div class="toolbar">
    {#if others.length || person}
      <select class="input narrow" aria-label={t("Whose tasks")} value={person?.id ?? ""}
        onchange={(e) => setParams({ user: (e.currentTarget as HTMLSelectElement).value || null })}>
        <option value="">{t("Mine")}</option>
        {#each others as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
        {#if person && !others.some((u) => u.id === person.id)}<option value={person.id}>{person.name}</option>{/if}
      </select>
    {/if}
    <input class="input" placeholder={t("Filter…")} bind:value={filter} />
    {#if labelChoices.length}
      <select class="input narrow" bind:value={labelFilter} aria-label={t("Label")}>
        <option value="">{t("Any label")}</option>
        {#each labelChoices as l (l.name)}<option value={l.name}>{l.name}</option>{/each}
      </select>
    {/if}
    <select class="input narrow" bind:value={priorityFilter} aria-label={t("Priority")}>
      <option value="">{t("Any priority")}</option>
      {#each PRIORITIES as p (p.value)}<option value={String(p.value)}>{t(p.label)}</option>{/each}
      <option value="0">{t("No priority")}</option>
    </select>
    <div class="seg" role="group" aria-label={t("Group")}>
      <button class:active={by === "state"} onclick={() => setBy("state")}>{t("By state")}</button>
      <button class:active={by === "pipe"} onclick={() => setBy("pipe")}>{t("By pipe")}</button>
      <button class:active={by === "priority"} onclick={() => setBy("priority")}>{t("By priority")}</button>
    </div>
  </div>

  {#if !tasks}
    <div class="muted">{t("Loading…")}</div>
  {:else if failed}
    <div class="callout danger">{t("This person's tasks cannot be shown.")}</div>
  {:else if !tasks.length}
    <div class="empty">{person ? t("{name} has nothing to do that you can see.", { name: person.name }) : t("Nothing to do for now. Enjoy!")}</div>
  {:else}
    {#each groups.filter((g) => g.tasks.length || by === "state") as g (g.id)}
      <div class="section">
        <div class="section-title">
          {g.label}<span class="count neutral">{g.tasks.length}</span>
          {#if g.hint}<span class="small muted hint-inline">{g.hint}</span>{/if}
        </div>
        {#if g.tasks.length}
          <div class="list">{#each g.tasks as task (task.id)}<TaskRow task={task} showLocation={by === "state"} />{/each}</div>
        {:else}
          <div class="small muted">{t("None.")}</div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .toolbar { display: flex; gap: 12px; align-items: center; }
  .toolbar { flex-wrap: wrap; }
  .toolbar .input { max-width: 320px; }
  .toolbar .narrow { width: auto; }
  .hint-inline { font-weight: 400; }
  .section { margin-top: 24px; }
</style>
