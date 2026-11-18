<script lang="ts">
  /**
   * The incoming webhook of a pipe (server: incoming.ts): another application (a form, a CRM, Zapier, n8n…) creates
   * tasks in it by POSTing JSON. Templates pick the task's fields out of the other application's body.
   */
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { relativeTime } from "../lib/constants";
  import { t } from "../lib/i18n.svelte";
  import type { GitIntegration } from "../lib/types";

  let { pipeId }: { pipeId: string } = $props();

  let hook = $state<GitIntegration | null>(null);
  let shown = $state(false);
  let busy = $state(false);
  let error = $state("");
  let title = $state("");
  let description = $state("");
  let dueDate = $state("");
  let externalId = $state("");

  const load = () =>
    api.get<GitIntegration[]>(`/pipes/${pipeId}/integrations`)
      .then((r) => {
        hook = r.find((i) => i.provider === "incoming") ?? null;
        title = hook?.templates?.title ?? "";
        description = hook?.templates?.description ?? "";
        dueDate = hook?.templates?.dueDate ?? "";
        externalId = hook?.templates?.externalId ?? "";
      })
      .catch((err) => (error = errorMessage(err)));
  load();

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    error = "";
    try {
      await fn();
      await load();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  const connect = () => run(async () => {
    await api.post(`/pipes/${pipeId}/integrations`, { provider: "incoming" });
    shown = true;
  });
  const renew = () => confirm(t("Make a new secret? The webhook will stop working until you update it on the other side.")) && connect();
  const disconnect = () =>
    confirm(t("Turn the incoming webhook off? The other application will no longer create tasks here.")) &&
    run(() => api.del(`/pipes/${pipeId}/integrations/incoming`));
  const save = () =>
    run(async () => {
      await api.patch(`/pipes/${pipeId}/integrations/incoming`, { templates: { title, description, dueDate, externalId } });
      app.toast(t("Saved"));
    });

  const example = $derived(
    hook
      ? `curl -X POST ${hook.url} \\\n  -H "Content-Type: application/json" \\\n  -H "X-TasksPipes-Token: ${hook.secret}" \\\n  -d '{"title": "Call ACME", "description": "From the website", "dueDate": "2026-12-01"}'`
      : ""
  );

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      app.toast(t("Copied"));
    } catch {
      app.toast(t("Could not copy: select the link"), "error");
    }
  }
</script>

<div class="incoming">
  <p class="hint top">
    {t("Another application (a form, a CRM, Zapier, n8n…) creates tasks in this pipe by sending JSON to an address of its own. The tasks are made as you.")}
  </p>
  <div class="row">
    <strong class="grow">{t("Incoming webhook")}</strong>
    {#if hook}
      <span class="small muted">{hook.lastEventAt ? t("last event {when}", { when: relativeTime(hook.lastEventAt) }) : t("no event received yet")}</span>
      <button type="button" class="btn ghost small" onclick={() => (shown = !shown)}>{shown ? t("Hide") : t("Settings")}</button>
      <button type="button" class="btn ghost small" disabled={busy} onclick={disconnect}>{t("Turn off")}</button>
    {:else}
      <button type="button" class="btn neutral small" disabled={busy} onclick={connect}>{t("Turn on")}</button>
    {/if}
  </div>

  {#if hook && shown}
    <div class="setup">
      <label class="label-text" for="incoming-url">{t("Webhook URL")}</label>
      <div class="row"><input id="incoming-url" class="input mono" readonly value={hook.url} /><button type="button" class="btn neutral small" onclick={() => copy(hook!.url)}>{t("Copy")}</button></div>
      <label class="label-text" for="incoming-secret">{t("Secret")}</label>
      <div class="row">
        <input id="incoming-secret" class="input mono" readonly value={hook.secret} />
        <button type="button" class="btn neutral small" onclick={() => copy(hook!.secret)}>{t("Copy")}</button>
        <button type="button" class="btn ghost small" disabled={busy} onclick={renew}>{t("New secret…")}</button>
      </div>
      <p class="small muted">
        {t("Send the secret in the X-TasksPipes-Token header (or Authorization: Bearer), or sign the body: X-TasksPipes-Signature: sha256=<HMAC-SHA256 of the body with the secret>.")}
      </p>
      <label class="label-text" for="incoming-example">{t("Example")}</label>
      <div class="row"><textarea id="incoming-example" class="input mono example" readonly rows="5">{example}</textarea><button type="button" class="btn neutral small" onclick={() => copy(example)}>{t("Copy")}</button></div>

      <details class="templates">
        <summary class="small">{t("Templates: when the other application sends its own fields")}</summary>
        <p class="small muted">{t("By default the body's title, description, dueDate, priority and externalId are used. Otherwise write each field with {{paths}} into the body, e.g. Lead: {{contact.name}}. An externalId already received makes no second task.")}</p>
        <label class="label-text" for="incoming-title">{t("Title")}</label>
        <input id="incoming-title" class="input mono" bind:value={title} placeholder={"{{title}}"} maxlength="2000" />
        <label class="label-text" for="incoming-description">{t("Description")}</label>
        <input id="incoming-description" class="input mono" bind:value={description} placeholder={"{{description}}"} maxlength="2000" />
        <label class="label-text" for="incoming-due">{t("Due date")}</label>
        <input id="incoming-due" class="input mono" bind:value={dueDate} placeholder={"{{dueDate}}"} maxlength="2000" />
        <label class="label-text" for="incoming-external">{t("External id")}</label>
        <input id="incoming-external" class="input mono" bind:value={externalId} placeholder={"{{externalId}}"} maxlength="2000" />
        <div class="row end"><button type="button" class="btn small" disabled={busy} onclick={save}>{t("Save")}</button></div>
      </details>
    </div>
  {/if}
  {#if error}<div class="error-text">{error}</div>{/if}
</div>

<style>
  .hint.top { margin: 0 0 8px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row.end { justify-content: flex-end; margin-top: 6px; }
  .grow { flex: 1; }
  .setup { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .setup .input { min-height: 30px; font-size: 12px; padding: 4px 8px; flex: 1; }
  .example { resize: vertical; }
  .templates { display: flex; flex-direction: column; gap: 6px; }
  .templates summary { cursor: pointer; }
  .mono { font-family: var(--font-mono); }
</style>
