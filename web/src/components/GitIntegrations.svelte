<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { relativeTime } from "../lib/constants";
  import { t } from "../lib/i18n.svelte";
  import type { GitIntegration } from "../lib/types";
  import Icon from "./Icon.svelte";

  /** GitHub / GitLab webhooks of a pipe: tasks named TP-123 in pull/merge requests move along. */
  let { pipeId }: { pipeId: string } = $props();

  const PROVIDERS = [
    { id: "github", name: "GitHub" },
    { id: "gitlab", name: "GitLab" },
  ] as const;

  let list = $state<GitIntegration[]>([]);
  let shown = $state<string | null>(null);
  let busy = $state(false);
  let error = $state("");

  const load = () => api.get<GitIntegration[]>(`/pipes/${pipeId}/integrations`).then((r) => (list = r)).catch((err) => (error = errorMessage(err)));
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

  const connect = (provider: string) => run(async () => {
    await api.post(`/pipes/${pipeId}/integrations`, { provider });
    shown = provider;
  });
  const renew = (provider: string) => confirm(t("Make a new secret? The webhook will stop working until you update it on the other side.")) && connect(provider);
  const disconnect = (provider: string) =>
    confirm(t("Disconnect? Pull/merge requests will no longer move the tasks of this pipe.")) && run(() => api.del(`/pipes/${pipeId}/integrations/${provider}`));

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      app.toast(t("Copied"));
    } catch {
      app.toast(t("Could not copy: select the link"), "error");
    }
  }
</script>

<div class="git">
  <p class="hint top">
    {t("Name a task with its key (TP-123) in a branch, a pull/merge request or a commit: it gets linked. A draft moves the task to “in progress”, an open request to review, a merge to done.")}
  </p>
  {#each PROVIDERS as p (p.id)}
    {@const integ = list.find((i) => i.provider === p.id)}
    <div class="provider">
      <div class="row">
        <Icon name="branch" size={16} />
        <strong class="grow">{p.name}</strong>
        {#if integ}
          <span class="small muted">
            {integ.lastEventAt ? t("last event {when}", { when: relativeTime(integ.lastEventAt) }) : t("no event received yet")}
          </span>
          <button type="button" class="btn ghost small" onclick={() => (shown = shown === p.id ? null : p.id)}>{shown === p.id ? t("Hide") : t("Settings")}</button>
          <button type="button" class="btn ghost small" disabled={busy} onclick={() => disconnect(p.id)}>{t("Disconnect")}</button>
        {:else}
          <button type="button" class="btn neutral small" disabled={busy} onclick={() => connect(p.id)}>{t("Connect")}</button>
        {/if}
      </div>
      {#if integ && shown === p.id}
        <div class="setup">
          <ol class="small">
            {#if p.id === "github"}
              <li>{t("In the GitHub repository: Settings › Webhooks › Add webhook.")}</li>
              <li>{t("Payload URL and secret below; content type: application/json.")}</li>
              <li>{t("Events: Pull requests and Pushes.")}</li>
            {:else}
              <li>{t("In the GitLab project: Settings › Webhooks › Add new webhook.")}</li>
              <li>{t("URL and secret token below.")}</li>
              <li>{t("Triggers: Push events and Merge request events.")}</li>
            {/if}
          </ol>
          <label class="label-text" for={`url-${p.id}`}>{t("Webhook URL")}</label>
          <div class="row"><input id={`url-${p.id}`} class="input mono" readonly value={integ.url} /><button type="button" class="btn neutral small" onclick={() => copy(integ.url)}>{t("Copy")}</button></div>
          <label class="label-text" for={`secret-${p.id}`}>{t("Secret")}</label>
          <div class="row">
            <input id={`secret-${p.id}`} class="input mono" readonly value={integ.secret} />
            <button type="button" class="btn neutral small" onclick={() => copy(integ.secret)}>{t("Copy")}</button>
            <button type="button" class="btn ghost small" disabled={busy} onclick={() => renew(p.id)}>{t("New secret…")}</button>
          </div>
        </div>
      {/if}
    </div>
  {/each}
  {#if error}<div class="error-text">{error}</div>{/if}
</div>

<style>
  .hint.top { margin: 0 0 8px; }
  .provider { border: 1px solid var(--divider); border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; }
  .grow { flex: 1; }
  .setup { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .setup ol { margin: 0 0 4px; padding-left: 18px; color: var(--text-secondary); }
  .setup .input { min-height: 30px; font-size: 12px; padding: 4px 8px; }
  .mono { font-family: var(--font-mono); }
</style>
