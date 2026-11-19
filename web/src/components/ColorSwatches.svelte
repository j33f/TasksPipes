<script lang="ts">
  /** The colours one may pick (Outline's palette) and a custom one: for pipes (IconPicker) and teams. */
  import { PALETTE } from "../lib/constants";
  import { t } from "../lib/i18n.svelte";

  let { value, onpick }: { value: string | null; onpick: (color: string) => void } = $props();
  const custom = $derived(!!value && !PALETTE.includes(value));
</script>

<div class="swatches">
  {#each PALETTE as c (c)}
    <button type="button" class="swatch" class:selected={value === c} style="background:{c}" aria-label={c} onclick={() => onpick(c)}></button>
  {/each}
  <label class="swatch custom" class:selected={custom} title={t("Custom colour")}
    style="background:{custom ? value : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)'}">
    <input type="color" aria-label={t("Custom colour")} value={value ?? "#2BC2FF"} onchange={(e) => onpick((e.currentTarget as HTMLInputElement).value)} />
  </label>
</div>

<style>
  .swatches { display: flex; flex-wrap: wrap; gap: 6px; }
  .swatch { width: 22px; height: 22px; border-radius: 50%; border: 0; cursor: pointer; padding: 0; }
  .swatch.selected { box-shadow: 0 0 0 2px var(--modal-background, var(--background)), 0 0 0 4px var(--text); }
  .custom { position: relative; overflow: hidden; }
  .custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
</style>
