<script lang="ts">
  import { app } from "../lib/app.svelte";

  import type { UserRef } from "../lib/types";
  import { t } from "../lib/i18n.svelte";
  import { awaitingSignIn } from "../lib/people";

  let { value = $bindable(null), placeholder = t("Person"), exclude = [], users, onchange, anyone = false }: {
    value?: string | null;
    placeholder?: string;
    exclude?: string[];
    /** Choices; defaults to everyone. */
    users?: UserRef[];
    onchange?: (v: string | null) => void;
    /** Also offer Outline colleagues who never signed in (a field naming someone, not a task or team for them). */
    anyone?: boolean;
  } = $props();

  const waiting = (id: string) => {
    const u = app.users.find((x) => x.id === id);
    return !anyone && Boolean(u && awaitingSignIn(u));
  };
</script>

<select class="input" bind:value onchange={() => onchange?.(value)}>
  <option value={null}>{placeholder}</option>
  {#each (users ?? app.users).filter((u) => !exclude.includes(u.id)) as u (u.id)}
    {#if waiting(u.id)}
      <option value={u.id} disabled>{t("{name} (has not signed in yet)", { name: u.name })}</option>
    {:else}
      <option value={u.id}>{u.name}</option>
    {/if}
  {/each}
</select>
