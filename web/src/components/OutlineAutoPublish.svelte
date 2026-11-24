<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { formatDateTime } from "../lib/constants";
  import { t } from "../lib/i18n.svelte";
  import type { DocRef, OutlineExport } from "../lib/types";
  import Icon from "./Icon.svelte";
  import DocPicker from "./DocPicker.svelte";

  /**
   * Reports a pipe publishes to Outline by itself: the daily activity at the report hour, and each sprint as it
   * closes (pipes in sprints), under a parent document, with an Outline API key given by a member.
   */
  let { pipe, hour }: { pipe: { id: string; kind: string }; hour: number } = $props();

  const inSprints = $derived(Boolean(app.pipeType(pipe.kind)?.sprints));
  let settings = $state<OutlineExport | null>(null);
  let loaded = $state(false);
  let editing = $state(false);
  let busy = $state(false);
  let error = $state("");
  // The form: a parent, a key (kept when left empty), what to publish.
  let parent = $state<DocRef | null>(null);
  let apiKey = $state("");
  let daily = $state(true);
  let sprints = $state(false);

  $effect(() => {
    api.get<OutlineExport | null>(`/pipes/${pipe.id}/outline-export`)
      .then((s) => (settings = s))
      .catch(() => (settings = null))
      .finally(() => (loaded = true));
  });

  function edit() {
    parent = settings ? { id: settings.parentDocId, title: settings.parentDocTitle, url: settings.parentDocUrl } : null;
    apiKey = "";
    daily = settings?.daily ?? true;
    sprints = settings?.sprints ?? inSprints;
    error = "";
    editing = true;
  }

  async function save(body: Record<string, unknown>) {
    busy = true;
    error = "";
    try {
      settings = await api.put<OutlineExport>(`/pipes/${pipe.id}/outline-export`, body);
      editing = false;
      app.toast(t("Saved"));
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    save({ parentDocumentId: parent?.id ?? "", daily, sprints: inSprints && sprints, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
  };

  async function stop() {
    busy = true;
    try {
      await api.del(`/pipes/${pipe.id}/outline-export`);
      settings = null;
      app.toast(t("Publishing to Outline stopped"));
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

{#if loaded && !app.noOutline}
  <div class="auto">
    <div class="section-title"><Icon name="doc" />{t("In Outline")}</div>
    {#if editing}
      <form onsubmit={submit}>
        <span class="small muted">{t("Parent document")}</span>
        {#if parent}
          <div class="row chosen"><Icon name="doc" size={16} /><span class="ellipsis">{parent.title}</span>
            <button type="button" class="btn ghost small" onclick={() => (parent = null)}>{t("Change")}</button></div>
        {:else}
          <DocPicker onselect={(d) => (parent = d)} />
        {/if}
        <label class="field">
          <span class="small muted">{t("Outline API key")}</span>
          <input class="input" type="password" autocomplete="off" bind:value={apiKey}
            placeholder={settings ? t("Leave empty to keep the current key") : "ol_api_…"} />
          <span class="small muted">{t("Create one in Outline › Settings › API. Reports are published as that account, even when nobody is signed in.")}</span>
        </label>
        <label class="check"><input type="checkbox" bind:checked={daily} />{t("Publish the daily activity every day at {hour}:00 (days with activity)", { hour })}</label>
        {#if inSprints}
          <label class="check"><input type="checkbox" bind:checked={sprints} />{t("Publish the report of each sprint when it closes")}</label>
        {/if}
        {#if error}<div class="error-text">{error}</div>{/if}
        <div class="row actions">
          <button class="btn primary small" disabled={busy || !parent || (!settings && !apiKey.trim())}>{t("Save")}</button>
          <button type="button" class="btn ghost small" onclick={() => (editing = false)}>{t("Cancel")}</button>
        </div>
      </form>
    {:else if settings}
      <p class="small">
        {t("Published under")} {#if settings.parentDocUrl}<a href={settings.parentDocUrl} target="_blank" rel="noopener noreferrer">{settings.parentDocTitle}</a>{:else}{settings.parentDocTitle}{/if}
        {#if settings.outlineUser}<span class="muted">{" · "}{t("as {name}", { name: settings.outlineUser })}</span>{/if}
      </p>
      {#if settings.keyRefused}
        <div class="error-text">{t("Outline refused the key: {error}. Give a new key to start again.", { error: settings.lastError ?? "" })}</div>
      {:else if settings.lastError}
        <div class="error-text small">{t("Last attempt failed: {error}", { error: settings.lastError })}</div>
      {/if}
      <label class="check"><input type="checkbox" checked={settings.daily} disabled={busy} onchange={(e) => save({ daily: e.currentTarget.checked })} />
        {t("Publish the daily activity every day at {hour}:00 (days with activity)", { hour })}</label>
      {#if inSprints}
        <label class="check"><input type="checkbox" checked={settings.sprints} disabled={busy} onchange={(e) => save({ sprints: e.currentTarget.checked })} />
          {t("Publish the report of each sprint when it closes")}</label>
      {/if}
      {#if settings.lastExportAt}
        <p class="small muted">{t("Last published {when}", { when: formatDateTime(settings.lastExportAt) })}{#if settings.lastExportUrl}{" · "}<a href={settings.lastExportUrl} target="_blank" rel="noopener noreferrer">{t("Open in Outline")}</a>{/if}</p>
      {/if}
      <div class="row actions">
        <button class="btn ghost small" onclick={edit}>{t("Change the key or the document")}</button>
        <button class="btn ghost small" disabled={busy} onclick={stop}>{t("Stop publishing")}</button>
      </div>
      {#if error}<div class="error-text">{error}</div>{/if}
    {:else}
      <button class="btn ghost small" onclick={edit}>{t("Publish the reports to Outline automatically…")}</button>
    {/if}
  </div>
{/if}

<style>
  .auto { margin-top: 16px; }
  .auto p { margin: 6px 0; }
  form { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .chosen { gap: 6px; font-size: 14px; min-width: 0; }
  .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .actions { gap: 8px; flex-wrap: wrap; }
  .check { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; margin: 6px 0; }
  a { overflow-wrap: anywhere; }
</style>
