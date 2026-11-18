<script lang="ts">
  /**
   * The icons one may give a pipe or a task type: the app's own first, then Lucide's, by theme (lib/lucide.ts), with a
   * search on their names. Used by IconPicker (pipes) and TaskTypeEditor.
   */
  import { PIPE_ICONS } from "../lib/constants";
  import { LUCIDE_GROUPS } from "../lib/lucide";
  import { t } from "../lib/i18n.svelte";
  import Icon from "./Icon.svelte";

  let { selected, color = null, size = 20, onpick }: {
    selected: string | null;
    color?: string | null;
    size?: number;
    onpick: (name: string) => void;
  } = $props();

  let query = $state("");
  const q = $derived(query.trim().toLowerCase());
  const matches = (name: string) => !q || name.includes(q);

  const groups = $derived(
    [{ label: "Basics", icons: PIPE_ICONS as string[] }, ...LUCIDE_GROUPS]
      .map((g) => ({ label: g.label, icons: g.icons.filter(matches) }))
      .filter((g) => g.icons.length)
  );
</script>

<div class="icon-choices">
  <input class="input search" type="search" placeholder={t("Search icons")} aria-label={t("Search icons")} bind:value={query} />
  <div class="scroll">
    {#each groups as g (g.label)}
      <div class="group-label small muted">{t(g.label)}</div>
      <div class="icons">
        {#each g.icons as name (name)}
          <button type="button" class="icon-btn" class:selected={selected === name} title={name} aria-label={name}
            style="color:{color || 'var(--text-secondary)'}" onclick={() => onpick(name)}><Icon {name} {size} /></button>
        {/each}
      </div>
    {:else}
      <p class="small muted">{t("No icon matches.")}</p>
    {/each}
  </div>
</div>

<style>
  .icon-choices { display: flex; flex-direction: column; gap: 6px; }
  .search { min-height: 30px; font-size: 13px; padding: 4px 8px; }
  .scroll { max-height: 240px; overflow-y: auto; padding-right: 2px; }
  .group-label { margin: 6px 0 2px; }
  .icons { display: flex; flex-wrap: wrap; gap: 2px; }
  .icon-btn {
    border: 0; background: none; padding: 5px; border-radius: 6px; cursor: pointer; display: inline-flex;
  }
  .icon-btn:hover { background: var(--list-hover); }
  .icon-btn.selected { background: var(--list-selected, var(--list-hover)); outline: 1px solid var(--divider); }
</style>
