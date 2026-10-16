<script lang="ts">
  import { app } from "../lib/app.svelte";

  import type { UserRef } from "../lib/types";

  let { value = $bindable(null), placeholder = "Personne", exclude = [], users, onchange }: {
    value?: string | null;
    placeholder?: string;
    exclude?: string[];
    /** Choices; defaults to everyone. */
    users?: UserRef[];
    onchange?: (v: string | null) => void;
  } = $props();
</script>

<select class="input" bind:value onchange={() => onchange?.(value)}>
  <option value={null}>{placeholder}</option>
  {#each (users ?? app.users).filter((u) => !exclude.includes(u.id)) as u (u.id)}
    <option value={u.id}>{u.name}</option>
  {/each}
</select>
