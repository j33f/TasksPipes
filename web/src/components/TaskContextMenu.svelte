<script lang="ts">
  /**
   * The menu of a task, opened with a right click on its card or row (app.openTaskMenu): open it, change its column,
   * priority or owner (one's own AI agent too), move it to another pipe of its space, delete it. What one may not do
   * is left out (not a member of its space); the server checks it all anyway.
   */
  import { tick } from "svelte";
  import { app } from "../lib/app.svelte";
  import { api, errorMessage } from "../lib/api";
  import { PRIORITIES } from "../lib/labels";
  import { agentChoices, ownerBody, ownerValue } from "../lib/agents";
  import type { Pipe, Task, UserRef } from "../lib/types";
  import { t } from "../lib/i18n.svelte";
  import Icon from "./Icon.svelte";

  let { task, x, y, onclose }: { task: Task; x: number; y: number; onclose: () => void } = $props();

  type View = "main" | "column" | "priority" | "owner" | "move";
  let view = $state<View>("main");
  let busy = $state(false);
  let menu = $state<HTMLDivElement>();
  let pos = $state({ left: 0, top: 0 });
  /** The pipes and members of the task's space, read when the menu opens. */
  let pipes = $state<Pipe[]>([]);
  let members = $state<UserRef[]>([]);

  const space = $derived(app.spaces.find((s) => s.id === task.space.id));
  /** A member of its space manages the task: column, owner, moving, deleting. */
  const member = $derived(Boolean(space?.myRole));
  const columns = $derived(task.pipe ? app.columnsFor(task.pipe.kind) : []);
  const otherPipes = $derived(pipes.filter((p) => p.id !== task.pipe?.id && !p.archived));
  const me = $derived(app.me?.user ?? null);
  const agents = $derived(
    agentChoices(task.space.kind === "team" ? (members.some((m) => m.id === me?.id) ? me : null) : task.assignee?.id === me?.id ? me : null,
      Boolean(app.me?.hasAgent), task.assignee)
  );
  /** Owners one may choose: the members of a team, or oneself in one's own space (then one's agent). */
  const owners = $derived(task.space.kind === "team" ? members : task.assignee && task.assignee.id === me?.id ? [task.assignee] : []);
  const current = $derived(ownerValue(task.assignee));

  // Its space's pipes and members, for a member (the menu is made again for each task: App.svelte).
  $effect(() => {
    if (!member) return;
    api.get<{ pipes: Pipe[]; members: UserRef[] }>(`/spaces/${task.space.id}`)
      .then((s) => { pipes = s.pipes ?? []; members = s.members ?? []; })
      .catch(() => {});
  });

  // Kept inside the window, then focused for the keyboard.
  $effect(() => {
    void view;
    tick().then(() => {
      if (!menu) return;
      const r = menu.getBoundingClientRect();
      pos = { left: Math.max(8, Math.min(x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, innerHeight - r.height - 8)) };
      menu.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus();
    });
  });

  async function act(fn: () => Promise<unknown>, done?: string) {
    busy = true;
    try {
      await fn();
      if (done) app.toast(done);
      app.refresh();
      onclose();
    } catch (err) {
      app.toast(errorMessage(err), "error");
      busy = false;
    }
  }

  const patch = (body: Record<string, unknown>) => act(() => api.patch(`/tasks/${task.id}`, body));
  const move = (pipe: Pipe) => act(() => api.post(`/tasks/${task.id}/move`, { pipeId: pipe.id }), t("Moved to {name}", { name: pipe.name }));
  function remove() {
    if (!confirm(t("Delete “{title}” for good, with its history, sub-tasks, files and logged time?", { title: task.title }))) return;
    act(() => api.del(`/tasks/${task.id}`), t("Task deleted"));
  }
  function open() {
    onclose();
    app.openTask(task.id);
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (view !== "main") view = "main";
      else onclose();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(menu?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  }
</script>

<svelte:window onkeydown={keydown} onresize={onclose} onscroll={onclose} />

<!-- A click anywhere else closes it; a right click elsewhere opens the menu of that other task instead. -->
<div class="backdrop" role="presentation" onclick={onclose} oncontextmenu={(e) => { e.preventDefault(); onclose(); }}></div>
<div class="task-menu" role="menu" aria-label={t("Task actions")} tabindex="-1" bind:this={menu}
  style:left="{pos.left}px" style:top="{pos.top}px">
  {#if view === "main"}
    <div class="m-title" title={task.title}>{task.title}</div>
    <button role="menuitem" onclick={open}><Icon name="arrow" size={14} />{t("Open the task")}</button>
    {#if member && task.pipe && columns.length}
      <button role="menuitem" disabled={busy} onclick={() => (view = "column")}><Icon name="pipe" size={14} />{t("Column")}<span class="more">›</span></button>
    {/if}
    {#if member}
      <button role="menuitem" disabled={busy} onclick={() => (view = "priority")}><Icon name="flag" size={14} />{t("Priority")}<span class="more">›</span></button>
    {/if}
    {#if member && (owners.length || agents.length)}
      <button role="menuitem" disabled={busy} onclick={() => (view = "owner")}><Icon name="user" size={14} />{t("Owner")}<span class="more">›</span></button>
    {/if}
    {#if member && task.pipe}
      <button role="menuitem" disabled={busy} onclick={() => (view = "move")}><Icon name="send" size={14} />{t("Move to another pipe")}<span class="more">›</span></button>
    {/if}
    {#if member}
      <hr />
      <button role="menuitem" class="danger" disabled={busy} onclick={remove}><Icon name="trash" size={14} />{t("Delete the task")}</button>
    {/if}
  {:else}
    <button role="menuitem" class="back" onclick={() => (view = "main")}>‹ {t("Back")}</button>
    <hr />
    {#if view === "column"}
      {#each columns as c (c.id)}
        <button role="menuitem" disabled={busy} aria-current={c.id === task.stage} onclick={() => c.id !== task.stage && patch({ stage: c.id })}>
          <span class="dot" style:background={c.color}></span>{c.label}{#if c.id === task.stage}<span class="more">✓</span>{/if}
        </button>
      {/each}
    {:else if view === "priority"}
      {#each PRIORITIES as p (p.value)}
        <button role="menuitem" disabled={busy} aria-current={p.value === task.priority} onclick={() => p.value !== task.priority && patch({ priority: p.value })}>
          <span class="dot" style:background={p.color}></span>{t(p.label)}{#if p.value === task.priority}<span class="more">✓</span>{/if}
        </button>
      {/each}
      <button role="menuitem" disabled={busy} aria-current={!task.priority} onclick={() => task.priority && patch({ priority: null })}>
        <span class="dot"></span>{t("No priority")}{#if !task.priority}<span class="more">✓</span>{/if}
      </button>
    {:else if view === "owner"}
      {#if task.space.kind === "team"}
        <button role="menuitem" disabled={busy} aria-current={!current} onclick={() => current && patch(ownerBody(null))}>{t("Unassigned")}{#if !current}<span class="more">✓</span>{/if}</button>
      {/if}
      {#each owners as u (u.id)}
        <button role="menuitem" disabled={busy} aria-current={current === u.id} onclick={() => current !== u.id && patch(ownerBody(u.id))}>
          {u.name}{#if current === u.id}<span class="more">✓</span>{/if}
        </button>
      {/each}
      {#each agents as a (a.id)}
        <button role="menuitem" disabled={busy || a.disabled} aria-current={current === `agent:${a.id}`}
          onclick={() => current !== `agent:${a.id}` && patch(ownerBody(`agent:${a.id}`))}>
          {t("{name} (MCP)", { name: a.name })}{#if current === `agent:${a.id}`}<span class="more">✓</span>{/if}
        </button>
      {/each}
    {:else if view === "move"}
      {#each otherPipes as p (p.id)}
        <button role="menuitem" disabled={busy} onclick={() => move(p)}>{p.name}</button>
      {:else}
        <div class="m-empty">{t("No other pipe in this space")}</div>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 90; }
  .task-menu {
    position: fixed; z-index: 91; min-width: 220px; max-width: min(320px, calc(100vw - 16px));
    max-height: calc(100vh - 16px); overflow-y: auto; padding: 4px;
    background: var(--card-background); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--card-shadow);
  }
  .m-title {
    padding: 6px 10px 4px; font-size: 12px; font-weight: 600; color: var(--text-secondary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .m-empty { padding: 8px 10px; font-size: 13px; color: var(--text-tertiary); }
  button {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; border-radius: 6px;
    background: none; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
  }
  button:hover:not(:disabled), button:focus-visible { background: var(--background-secondary); outline: none; }
  button:disabled { opacity: 0.5; cursor: default; }
  button.danger { color: #ed2651; }
  button.back { color: var(--text-secondary); }
  .more { margin-left: auto; color: var(--text-tertiary); }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; background: var(--border); }
  hr { border: 0; border-top: 1px solid var(--border); margin: 4px 0; }
</style>
