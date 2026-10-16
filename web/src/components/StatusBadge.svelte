<script lang="ts">
  import { STATUS_BY_ID } from "../lib/constants";
  import type { Status } from "../lib/types";

  let { status }: { status: Status } = $props();
  const s = $derived(STATUS_BY_ID[status]);
</script>

<span class="badge"><span class="status-dot" style="background:{s.color}"></span>{s.label}</span>
