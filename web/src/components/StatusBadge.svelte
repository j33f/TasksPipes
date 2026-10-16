<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { STATUS_BY_ID } from "../lib/constants";
  import type { Task } from "../lib/types";

  /** The task's board column, or its generic status outside a known column. */
  let { task }: { task: Pick<Task, "status" | "stage" | "pipe"> } = $props();
  const s = $derived(app.columnOf(task) ?? STATUS_BY_ID[task.status]);
</script>

<span class="badge"><span class="status-dot" style="background:{s.color}"></span>{s.label}</span>
