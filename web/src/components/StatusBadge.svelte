<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { STATUS_BY_ID } from "../lib/constants";
  import type { Task } from "../lib/types";
  import { t } from "../lib/i18n.svelte";

  /** The task's board column, or its generic status outside a known column. */
  let { task }: { task: Pick<Task, "status" | "stage" | "pipe"> } = $props();
  const s = $derived(app.columnOf(task) ?? STATUS_BY_ID[task.status]);
</script>

<span class="badge"><span class="status-dot" style="background:{s.color}"></span>{"status" in s ? s.label : t(s.label)}</span>
