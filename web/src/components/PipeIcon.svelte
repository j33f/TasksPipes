<script lang="ts">
  import { app } from "../lib/app.svelte";
  import Icon, { isIconName } from "./Icon.svelte";

  let { pipe, size = 20 }: { pipe: { icon?: string | null; kind?: string; color: string | null }; size?: number } = $props();

  const icon = $derived(pipe.icon || app.pipeType(pipe.kind)?.icon || "pipe");
</script>

{#if isIconName(icon)}
  <span class="pipe-icon" style="color:{pipe.color || 'var(--text-tertiary)'}"><Icon name={icon} {size} /></span>
{:else}
  <span class="pipe-icon" style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.85)}px">{icon}</span>
{/if}

<style>
  .pipe-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; line-height: 1; }
</style>
