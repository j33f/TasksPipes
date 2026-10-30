<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { api } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import Modal from "./Modal.svelte";
  import Icon from "./Icon.svelte";

  let { onclose }: { onclose: () => void } = $props();

  const REPO = "https://github.com/j33f/TasksPipes";

  // A newer version published (the server checks every hour, unless an administrator turned it off).
  let latest = $state<{ version: string; url: string } | null>(null);
  $effect(() => {
    api.get<{ latest: { version: string; url: string } | null; updateAvailable: boolean }>("/version")
      .then((v) => (latest = v.updateAvailable ? v.latest : null))
      .catch(() => {});
  });
</script>

<Modal {onclose}>
  <div class="about">
    <svg width="48" height="48" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="currentColor"/><rect x="7" y="8" width="5" height="16" rx="2" fill="var(--modal-background)"/><rect x="14" y="8" width="5" height="11" rx="2" fill="var(--modal-background)" opacity=".75"/><rect x="21" y="8" width="5" height="7" rx="2" fill="var(--modal-background)" opacity=".5"/></svg>
    <h2>TasksPipes</h2>
    <div class="muted">{t("Version {version}", { version: __APP_VERSION__ })}</div>
    {#if latest}
      <div class="callout update" role="status">
        <Icon name="bolt" size={18} />
        <div class="grow">
          <strong>{t("Version {version} is available", { version: latest.version })}</strong>
          <div class="small">{app.me?.admin ? t("Update the instance to get it (see the hosting guide).") : t("Your administrator can update the instance.")}</div>
        </div>
        <a class="btn small" href={latest.url} target="_blank" rel="noreferrer">{t("See what's new")}</a>
      </div>
    {/if}
    <p>{t("Task pipes for teams that live in Outline: kanban boards, incoming buckets and a GTD view.")}</p>
    <div class="links">
      <a class="btn neutral small" href={REPO} target="_blank" rel="noreferrer">{t("Source code on GitHub")}</a>
      <a class="btn ghost small" href={`${REPO}/releases/tag/v${__APP_VERSION__}`} target="_blank" rel="noreferrer">{t("Release notes")}</a>
      <a class="btn ghost small" href={`${REPO}/issues`} target="_blank" rel="noreferrer">{t("Report a problem")}</a>
    </div>
    <p class="small muted">
      {t("Distributed under the Business Source License 1.1, like Outline; it becomes Apache 2.0 on 2030-10-16.")}
      <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">{t("Read the license")}</a>
    </p>
    <p class="small muted">{t("Built with Svelte, Fastify and PostgreSQL. Not affiliated with Outline.")}</p>
  </div>
</Modal>

<style>
  .about { text-align: center; padding: 8px 8px 0; }
  .about svg { color: var(--text); }
  h2 { font-size: 22px; margin: 10px 0 2px; }
  p { margin: 14px 0 0; line-height: 1.5; }
  .update { margin: 16px 0 0; text-align: left; align-items: center; box-shadow: inset 0 0 0 1px var(--accent); }
  .update .small { color: var(--text-secondary); font-size: 13px; }
  .links { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; margin-top: 16px; }
</style>
