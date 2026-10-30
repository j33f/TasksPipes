<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import type { LinkSource, OutlineDoc, PipeLink } from "../lib/types";
  import Icon from "./Icon.svelte";
  import DocPicker from "./DocPicker.svelte";
  import { app } from "../lib/app.svelte";
  import { t } from "../lib/i18n.svelte";
  import { LINK_SOURCES, linkSource, sourcesFor } from "../lib/links";

  // Documents linked to a pipe, under its description: Outline documents (searched, or created from the pipe) and
  // pages elsewhere, the sources offered depending on the pipe type. Its members add and remove them.
  let { pipe, onchange }: { pipe: { id: string; kind: string; links: PipeLink[]; canManage: boolean }; onchange: () => void } = $props();

  let mode = $state<"idle" | "choose" | "outline" | "create" | "url">("idle");
  let chosen = $state<LinkSource>("link");
  let url = $state("");
  let title = $state("");
  let collections = $state<{ id: string; name: string }[]>([]);
  let collectionId = $state<string | null>(null);
  let busy = $state(false);

  const outlineOn = $derived(app.me?.features.outline !== false);
  // Outline documents are hidden while Outline is turned off.
  const shown = $derived(pipe.links.filter((l) => outlineOn || l.source !== "outline"));
  const choices = $derived(sourcesFor(pipe.kind, !app.noOutline));
  // The source of the address being typed, else the one chosen.
  const detected = $derived(url.trim() ? linkSource(url.trim(), app.me?.outlineUrl) : chosen);
  const label = (s: LinkSource) => (s === "link" ? t("Other link") : LINK_SOURCES[s].label);

  async function run(action: () => Promise<unknown>, done: string) {
    busy = true;
    try {
      await action();
      app.toast(done);
      reset();
      onchange();
    } catch (err) {
      app.toast(errorMessage(err), "error");
    } finally {
      busy = false;
    }
  }

  function reset() {
    mode = "idle";
    url = "";
    title = "";
  }

  function choose(s: LinkSource) {
    chosen = s;
    mode = s === "outline" ? "outline" : "url";
  }

  const addUrl = (e: SubmitEvent) => {
    e.preventDefault();
    run(() => api.post(`/pipes/${pipe.id}/links`, { url: url.trim(), title: title.trim() }), t("Link added"));
  };
  const addDoc = (doc: OutlineDoc) =>
    run(() => api.post(`/pipes/${pipe.id}/links`, { url: doc.url, title: doc.title, outlineDocId: doc.id }), t("Document linked"));
  const remove = (l: PipeLink) => run(() => api.del(`/pipes/${pipe.id}/links/${l.id}`), t("Link removed"));

  async function startCreate() {
    mode = "create";
    try {
      collections = await api.get(`/outline/collections`);
      collectionId = collections[0]?.id ?? null;
    } catch (err) {
      app.toast(errorMessage(err), "error");
      mode = "outline";
    }
  }
  const create = () => run(() => api.post(`/pipes/${pipe.id}/outline-document`, { collectionId }), t("Document created in Outline"));
</script>

{#snippet sourceIcon(s: LinkSource)}
  <span class="source" style:color={LINK_SOURCES[s].color || null}><Icon name={LINK_SOURCES[s].icon} size={16} /></span>
{/snippet}

{#if shown.length || pipe.canManage}
  <div class="pipe-links">
    <div class="row wrap chips">
      {#each shown as l (l.id)}
        <span class="chip">
          <a class="doc-link" href={l.url} target="_blank" rel="noreferrer" title={`${label(l.source)} · ${l.url}`}>
            {@render sourceIcon(l.source)}<span>{l.title}</span>
          </a>
          {#if pipe.canManage}
            <button class="btn ghost icon small" title={t("Remove the link")} disabled={busy} onclick={() => remove(l)}><Icon name="close" size={14} /></button>
          {/if}
        </span>
      {/each}
      {#if pipe.canManage && mode === "idle"}
        <button class="btn ghost small" onclick={() => (mode = "choose")}><Icon name="link" size={16} />{t("Link a document")}</button>
      {/if}
    </div>

    {#if mode === "choose"}
      <div class="panel row wrap" role="group" aria-label={t("Where is the document?")}>
        {#each choices as s (s)}
          <button class="btn neutral small" onclick={() => choose(s)}>{@render sourceIcon(s)}{label(s)}</button>
        {/each}
        <button class="btn ghost small" onclick={reset}>{t("Cancel")}</button>
      </div>
    {:else if mode === "outline"}
      <div class="panel row wrap">
        <div class="picker"><DocPicker onselect={addDoc} autofocus /></div>
        <button class="btn ghost small" onclick={startCreate}>{t("Create in Outline")}</button>
        <button class="btn ghost small" onclick={reset}>{t("Cancel")}</button>
      </div>
    {:else if mode === "create"}
      <div class="panel row wrap">
        <select class="input compact" bind:value={collectionId} aria-label={t("Collection")}>
          {#each collections as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
        <button class="btn small" disabled={!collectionId || busy} onclick={create}>{t("Create")}</button>
        <button class="btn ghost small" onclick={reset}>{t("Cancel")}</button>
      </div>
    {:else if mode === "url"}
      <form class="panel row wrap" onsubmit={addUrl}>
        {@render sourceIcon(detected)}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="input compact address" type="url" required autofocus bind:value={url} aria-label={t("Address")}
          placeholder={t("Address of the document ({source})", { source: label(chosen) })} />
        <input class="input compact" bind:value={title} maxlength="500" aria-label={t("Title")} placeholder={t("Title (optional)")} />
        <button class="btn small" type="submit" disabled={!url.trim() || busy}>{t("Add")}</button>
        <button class="btn ghost small" type="button" onclick={reset}>{t("Cancel")}</button>
      </form>
    {/if}
  </div>
{/if}

<style>
  .pipe-links { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .chips { gap: 6px; align-items: center; }
  .chip { display: inline-flex; align-items: center; max-width: 100%; }
  .panel { gap: 6px; align-items: center; }
  .picker { width: 320px; max-width: 100%; }
  .compact { width: auto; min-height: 32px; height: 32px; padding: 2px 8px; font-size: 14px; }
  .address { width: 340px; max-width: 100%; }
  .source { display: inline-flex; color: var(--text-tertiary); }
</style>
