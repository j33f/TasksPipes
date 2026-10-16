<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import Markdown from "./Markdown.svelte";

  let { value = $bindable(""), placeholder = t("Write in Markdown…"), rows = 6, autofocus = false }: {
    value?: string;
    placeholder?: string;
    rows?: number;
    autofocus?: boolean;
  } = $props();

  let tab = $state<"write" | "preview">("write");
</script>

<div class="md-editor">
  <div class="md-tabs">
    <button type="button" class="md-tab" class:active={tab === "write"} onclick={() => (tab = "write")}>{t("Write")}</button>
    <button type="button" class="md-tab" class:active={tab === "preview"} onclick={() => (tab = "preview")}>{t("Preview")}</button>
    <span class="spacer"></span>
    <a class="muted small hint-link" href="https://www.markdownguide.org/cheat-sheet/" target="_blank" rel="noreferrer">Markdown</a>
  </div>
  {#if tab === "write"}
    <!-- svelte-ignore a11y_autofocus -->
    <textarea class="input" {rows} {placeholder} {autofocus} bind:value></textarea>
  {:else}
    <div class="md-preview">
      {#if value}<Markdown source={value} />{:else}<span class="muted small">{t("Nothing to preview")}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .md-editor { border: 1px solid var(--input-border); border-radius: 6px; overflow: hidden; }
  .md-editor:focus-within { border-color: var(--input-border-focused); }
  .md-tabs { display: flex; gap: 2px; padding: 4px; border-bottom: 1px solid var(--divider); background: var(--background-secondary); align-items: center; }
  .md-tab { border: 0; background: none; color: var(--text-tertiary); padding: 3px 10px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; }
  .md-tab.active { background: var(--background); color: var(--text); box-shadow: var(--card-shadow); }
  .hint-link { padding-right: 6px; color: var(--text-tertiary); }
  textarea { border: 0; border-radius: 0; display: block; font-family: var(--font-mono); font-size: 13px; }
  .md-preview { padding: 10px 12px; min-height: 120px; }
</style>
