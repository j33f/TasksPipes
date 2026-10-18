<script lang="ts">
  import type { Label, Priority } from "../lib/types";
  import { labelText, priorityName, priorityOf } from "../lib/labels";
  import Icon from "./Icon.svelte";

  /** Priority flag (none shown without one) and label chips of a task. */
  let { priority = null, labels = [] }: { priority?: Priority | null; labels?: Label[] } = $props();
  const p = $derived(priorityOf(priority));
</script>

{#if p}
  <span class="prio" style="color:{p.color}" title={priorityName(priority)} aria-label={priorityName(priority)}><Icon name="flag" size={13} /></span>
{/if}
{#each labels as l (l.id)}
  <span class="chip" style="background:{l.color};color:{labelText(l.color)}">{l.name}</span>
{/each}

<style>
  .prio { display: inline-flex; align-items: center; }
  .chip { display: inline-block; font-size: 11px; line-height: 16px; padding: 0 6px; border-radius: 8px; font-weight: 500; white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
</style>
