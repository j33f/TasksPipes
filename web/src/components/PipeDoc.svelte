<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import type { DocRef } from "../lib/types";
  import Icon from "./Icon.svelte";
  import DocPicker from "./DocPicker.svelte";
  import { app } from "../lib/app.svelte";
  import { t } from "../lib/i18n.svelte";

  // The Outline document of a pipe: shown under its description; its members link, unlink or create one.
  let { pipe, onchange }: { pipe: { id: string; outlineDoc: DocRef | null; canManage: boolean }; onchange: () => void } = $props();

  let mode = $state<"idle" | "pick" | "create">("idle");
  let collections = $state<{ id: string; name: string }[]>([]);
  let collectionId = $state<string | null>(null);
  let busy = $state(false);

  const editable = $derived(pipe.canManage && !app.noOutline);

  async function run(action: () => Promise<unknown>, done: string) {
    busy = true;
    try {
      await action();
      app.toast(done);
      mode = "idle";
      onchange();
    } catch (err) {
      app.toast(errorMessage(err), "error");
    } finally {
      busy = false;
    }
  }

  const link = (doc: DocRef | null) =>
    run(() => api.patch(`/pipes/${pipe.id}`, { outlineDoc: doc }), doc ? t("Document linked") : t("Document unlinked"));

  async function startCreate() {
    mode = "create";
    try {
      collections = await api.get(`/outline/collections`);
      collectionId = collections[0]?.id ?? null;
    } catch (err) {
      app.toast(errorMessage(err), "error");
      mode = "idle";
    }
  }

  const create = () => run(() => api.post(`/pipes/${pipe.id}/outline-document`, { collectionId }), t("Document created in Outline"));
</script>

{#if app.me?.features.outline !== false && (pipe.outlineDoc || editable)}
  <div class="pipe-doc row wrap">
    {#if pipe.outlineDoc}
      <a class="doc-link" href={pipe.outlineDoc.url ?? "#"} target="_blank" rel="noreferrer">
        <Icon name="doc" size={16} /><span>{pipe.outlineDoc.title}</span>
      </a>
      {#if pipe.canManage}
        <button class="btn ghost icon small" title={t("Unlink")} disabled={busy} onclick={() => link(null)}><Icon name="unlink" size={16} /></button>
      {/if}
    {:else if mode === "pick"}
      <div class="picker"><DocPicker onselect={link} autofocus /></div>
      <button class="btn ghost small" onclick={() => (mode = "idle")}>{t("Cancel")}</button>
    {:else if mode === "create"}
      <select class="input collection" bind:value={collectionId} aria-label={t("Collection")}>
        {#each collections as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
      </select>
      <button class="btn small" disabled={!collectionId || busy} onclick={create}>{t("Create")}</button>
      <button class="btn ghost small" onclick={() => (mode = "idle")}>{t("Cancel")}</button>
    {:else}
      <span class="muted"><Icon name="doc" size={16} /></span>
      <button class="btn ghost small" onclick={() => (mode = "pick")}>{t("Link a document")}</button>
      <button class="btn ghost small" onclick={startCreate}>{t("Create in Outline")}</button>
    {/if}
  </div>
{/if}

<style>
  .pipe-doc { margin-top: 8px; align-items: center; gap: 6px; }
  .picker { width: 320px; max-width: 100%; }
  .collection { width: auto; min-height: 32px; height: 32px; padding: 2px 8px; font-size: 14px; }
  .muted { display: inline-flex; color: var(--text-tertiary); }
</style>
