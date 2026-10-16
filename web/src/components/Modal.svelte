<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  let { title, onclose, large = false, children }: {
    title?: string;
    onclose: () => void;
    large?: boolean;
    children: Snippet;
  } = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="modal-backdrop" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal" class:large role="dialog" aria-modal="true" aria-label={title}>
    <button class="btn ghost icon small modal-close" onclick={onclose} aria-label="Fermer">
      <Icon name="close" size={18} />
    </button>
    {#if title}<div class="modal-title">{title}</div>{/if}
    {@render children()}
  </div>
</div>
