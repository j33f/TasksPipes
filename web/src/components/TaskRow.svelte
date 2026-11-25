<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { dueState, formatDate } from "../lib/constants";
  import type { Task } from "../lib/types";
  import Avatar from "./Avatar.svelte";
  import McpTag from "./McpTag.svelte";
  import TaskBadges from "./TaskBadges.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";

  let { task, showLocation = true }: { task: Task; showLocation?: boolean } = $props();
  const due = $derived(dueState(task.dueDate, task.status));
</script>

<button class="list-item" data-task-id={task.id} onclick={() => app.openTask(task.id)}>
  {#if task.inIncoming}<span class="badge">{t("Incoming")}</span>{:else}<StatusBadge {task} />{/if}
  <span class="title">{task.title}</span>
  <TaskBadges priority={task.priority} labels={task.labels} />
  {#if showLocation}
    <span class="muted small loc">{task.space.name}{task.pipe ? ` › ${task.pipe.name}` : ""}</span>
  {/if}
  {#if task.checklist.total}
    <span class="small muted row" style="gap:3px" title={t("Sub-tasks")}><Icon name="checklist" size={14} />{task.checklist.done}/{task.checklist.total}</span>
  {/if}
  {#if task.dueDate}<span class="small due {due}">{formatDate(task.dueDate)}</span>{/if}
  {#if task.assignee}<Avatar user={task.assignee} size={20} />{#if task.assignee.agent}<McpTag />{/if}{/if}
</button>

<style>
  /* Where the task is gives way first: before the title, and alone on a phone's width. */
  .loc { flex: 0 4 auto; min-width: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .due { white-space: nowrap; flex-shrink: 0; }
  /* On a phone the title and the date first: the labels show in the task. */
  @media (max-width: 600px) { .loc, .list-item :global(.chip) { display: none; } }
</style>
