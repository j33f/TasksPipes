<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { DocRef, OutlineDoc, OutlineExport } from "../lib/types";
  import Icon from "./Icon.svelte";
  import DocPicker from "./DocPicker.svelte";

  /**
   * Publishes a report to Outline with one's own Outline account, as a child of a document: the one the pipe
   * publishes under when it has one, or any document picked. `path` is the export route, `body` what it needs
   * besides the parent (the day of a report). The weekly time report goes under its own parent when the pipe has one.
   */
  let { pipeId, path, body = {}, weekly = false }: { pipeId: string; path: string; body?: Record<string, unknown>; weekly?: boolean } = $props();

  let open = $state(false);
  let busy = $state(false);
  let parent = $state<DocRef | null>(null);
  let published = $state<DocRef | null>(null);

  async function toggle() {
    open = !open;
    published = null;
    if (open && !parent) {
      const s = await api.get<OutlineExport | null>(`/pipes/${pipeId}/outline-export`).catch(() => null);
      if (s && weekly && s.weeklyParentDocId) parent = { id: s.weeklyParentDocId, title: s.weeklyParentDocTitle ?? "", url: s.weeklyParentDocUrl };
      else if (s) parent = { id: s.parentDocId, title: s.parentDocTitle, url: s.parentDocUrl };
    }
  }

  async function publish(doc: DocRef | OutlineDoc) {
    busy = true;
    try {
      published = await api.post<DocRef>(path, { ...body, parentDocumentId: doc.id });
      app.toast(t("Published to Outline"));
    } catch (err) {
      app.toast(errorMessage(err), "error");
    } finally {
      busy = false;
    }
  }
</script>

{#if !app.noOutline}
  <div class="publish">
    <button class="btn ghost small" onclick={toggle} aria-expanded={open}><Icon name="doc" size={16} />{t("Publish to Outline")}</button>
    {#if open}
      <div class="panel">
        {#if published}
          <p class="small">{t("Published:")} <a href={published.url} target="_blank" rel="noopener noreferrer">{published.title}</a></p>
        {:else}
          {#if parent}
            <button class="btn primary small" disabled={busy} onclick={() => publish(parent!)}>{t("Publish under “{title}”", { title: parent.title })}</button>
            <p class="small muted">{t("Or under another document:")}</p>
          {:else}
            <p class="small muted">{t("The report becomes a document under the one you pick:")}</p>
          {/if}
          <DocPicker onselect={publish} />
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .publish { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-bottom: 12px; }
  .panel { width: 100%; box-sizing: border-box; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 8px; background: var(--background-secondary); }
  .panel :global(.picker) { width: 100%; }
  .panel p { margin: 0; }
  .panel a { overflow-wrap: anywhere; }
</style>
