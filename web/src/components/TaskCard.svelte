<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { dueState, formatDate } from "../lib/constants";
  import type { Task } from "../lib/types";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";

  let { task, draggable = false, dragging = false, ondragstart, ondragend }: {
    task: Task;
    draggable?: boolean;
    dragging?: boolean;
    ondragstart?: (e: DragEvent) => void;
    ondragend?: (e: DragEvent) => void;
  } = $props();

  const due = $derived(dueState(task.dueDate, task.status));
</script>

<div class="task-card" class:dragging data-task-card={task.id} {draggable} {ondragstart} {ondragend}
  role="button" tabindex="0" onclick={() => app.openTask(task.id)}
  onkeydown={(e) => e.key === "Enter" && app.openTask(task.id)}>
  <div class="t-title">{task.title}</div>
  <div class="t-meta">
    <span class="muted">#{task.number}</span>
    {#if task.dueDate}
      <span class="row due {due}" style="gap:3px"><Icon name="calendar" size={13} />{formatDate(task.dueDate)}</span>
    {/if}
    {#if task.outlineDoc}<span title={task.outlineDoc.title}><Icon name="doc" size={14} /></span>{/if}
    {#if task.commentCount}<span class="row" style="gap:3px"><Icon name="comment" size={13} />{task.commentCount}</span>{/if}
    <span class="spacer"></span>
    {#if task.author.id !== task.assignee?.id && task.author.id !== app.me?.user.id}
      <span class="muted" title={`Créée par ${task.author.name}`}>par {task.author.name.split(" ")[0]}</span>
    {/if}
    {#if task.assignee && task.space.kind === "team"}<Avatar user={task.assignee} size={20} />{/if}
  </div>
</div>

<style>
  .task-card {
    background: var(--card-background); border-radius: 8px; box-shadow: var(--card-shadow);
    padding: 10px 12px; cursor: pointer; font-size: 14px; outline: none;
  }
  .task-card:hover, .task-card:focus-visible { box-shadow: var(--card-shadow), 0 2px 8px rgb(0 0 0 / 10%); }
  .task-card.dragging { opacity: 0.4; }
  .t-title { font-weight: 500; line-height: 1.35; word-break: break-word; }
  .t-meta { display: flex; align-items: center; gap: 8px; margin-top: 8px; color: var(--text-tertiary); font-size: 12px; flex-wrap: wrap; }
</style>
