<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { t } from "../lib/i18n.svelte";

  let { value = $bindable(null), excludeId = null, includeSelf = true }: {
    value?: string | null;
    excludeId?: string | null;
    includeSelf?: boolean;
  } = $props();

  const me = $derived(app.me?.personalSpaceId);
  const teams = $derived(app.spaces.filter((s) => s.kind === "team" && s.id !== excludeId));
  const people = $derived(app.spaces.filter((s) => s.kind === "user" && s.id !== excludeId && (includeSelf || s.id !== me)));
</script>

<select class="input" bind:value>
  <option value={null}>{t("Choose a recipient…")}</option>
  {#if teams.length}
    <optgroup label={t("Teams")}>
      {#each teams as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
    </optgroup>
  {/if}
  <optgroup label={t("People")}>
    {#each people as s (s.id)}<option value={s.id}>{s.id === me ? t("{name} (me)", { name: s.name }) : s.name}</option>{/each}
  </optgroup>
</select>
