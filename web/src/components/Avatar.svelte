<script lang="ts">
  import { colorFor, initials } from "../lib/constants";
  import type { UserRef } from "../lib/types";

  let { user, size = 24 }: { user: UserRef | null | undefined; size?: number } = $props();
  let failed = $state(false);
</script>

{#if user}
  {#if user.avatarUrl && !failed}
    <img class="avatar" src={user.avatarUrl} alt="" title={user.name}
      style="width:{size}px;height:{size}px" onerror={() => (failed = true)} />
  {:else}
    <span class="avatar" title={user.name}
      style="width:{size}px;height:{size}px;font-size:{Math.max(9, size * 0.4)}px;background:{colorFor(user.id || user.name)}">
      {initials(user.name)}
    </span>
  {/if}
{/if}
