<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { dueState, formatDate } from "../lib/constants";
  import type { Task } from "../lib/types";
  import Avatar from "./Avatar.svelte";
  import TaskBadges from "./TaskBadges.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";

  let { task, showLocation = true }: { task: Task; showLocation?: boolean } = $props();
  const due = $derived(dueState(task.dueDate, task.status));
</script>

<button class="list-item" onclick={() => app.openTask(task.id)}>
  {#if task.inIncoming}<span class="badge">Incoming</span>{:else}<StatusBadge {task} />{/if}
  <span class="title">{task.title}</span>
  <TaskBadges priority={task.priority} labels={task.labels} />
  {#if showLocation}
    <span class="muted small loc">{task.space.name}{task.pipe ? ` › ${task.pipe.name}` : ""}</span>
  {/if}
  {#if task.checklist.total}
    <span class="small muted row" style="gap:3px" title={t("Sub-tasks")}><Icon name="checklist" size={14} />{task.checklist.done}/{task.checklist.total}</span>
  {/if}
  {#if task.dueDate}<span class="small due {due}">{formatDate(task.dueDate)}</span>{/if}
  {#if task.assignee}<Avatar user={task.assignee} size={20} />{/if}
</button>

<style>
  .loc { max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
