<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { formatDate, relativeTime } from "../lib/constants";
  import Icon from "./Icon.svelte";
  import type { AccessToken } from "../lib/types";
  import { t } from "../lib/i18n.svelte";

  let tokens = $state<AccessToken[]>([]);
  let name = $state("");
  let scope = $state<"read" | "write">("read");
  let days = $state(90);
  let created = $state<string | null>(null);
  let error = $state("");

  const load = () => api.get<AccessToken[]>("/me/tokens").then((r) => (tokens = r)).catch((err) => (error = errorMessage(err)));
  load();

  async function create(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    try {
      const r = await api.post<{ token: string }>("/me/tokens", { name, scope, days });
      created = r.token;
      name = "";
      await load();
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function revoke(tk: AccessToken) {
    if (!confirm(t("Revoke the token “{name}”? Whatever uses it stops working.", { name: tk.name }))) return;
    await api.del(`/me/tokens/${tk.id}`).then(load).catch((err) => app.toast(errorMessage(err), "error"));
  }

  const copy = () => navigator.clipboard.writeText(created!).then(() => app.toast(t("Copied"))).catch(() => {});
</script>

<div class="section">
  <div class="section-title"><Icon name="lock" />{t("Access tokens")}</div>
  <p class="small">
    {t("For scripts and other tools: a token acts with your rights on the API.")}
    <a href="/api/v1/docs" target="_blank" rel="noopener">{t("API documentation")}</a>
  </p>
  {#if created}
    <div class="callout created" role="status">
      <div>
        <strong>{t("Copy this token now: it will not be shown again.")}</strong>
        <code class="token">{created}</code>
      </div>
      <button class="btn small" onclick={copy}>{t("Copy")}</button>
    </div>
  {/if}
  {#each tokens as tk (tk.id)}
    <div class="row token-row">
      <span class="grow">
        <strong>{tk.name}</strong> <code>{tk.prefix}…</code>
        <span class="badge">{tk.scope === "write" ? t("Read and write") : t("Read only")}</span>
        <span class="small muted">
          {tk.expired ? t("expired") : t("expires on {date}", { date: formatDate(tk.expiresAt) })}
          · {tk.lastUsedAt ? t("used {when}", { when: relativeTime(tk.lastUsedAt) }) : t("never used")}
        </span>
      </span>
      <button class="btn ghost small" onclick={() => revoke(tk)}>{t("Revoke")}</button>
    </div>
  {/each}
  <form class="row create" onsubmit={create}>
    <input class="input" placeholder={t("Token name")} aria-label={t("Token name")} bind:value={name} maxlength="100" />
    <select class="input" bind:value={scope} aria-label={t("What the token may do")}>
      <option value="read">{t("Read only")}</option>
      <option value="write">{t("Read and write")}</option>
    </select>
    <select class="input" bind:value={days} aria-label={t("Valid for")}>
      <option value={30}>{t("30 days")}</option>
      <option value={90}>{t("90 days")}</option>
      <option value={365}>{t("1 year")}</option>
    </select>
    <button class="btn small" disabled={!name.trim()}>{t("Create")}</button>
  </form>
  {#if error}<p class="error-text">{error}</p>{/if}
</div>

<style>
  .section { margin-top: 24px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .grow { flex: 1; min-width: 0; }
  .token-row { padding: 6px 0; border-top: 1px solid var(--divider); }
  .create { margin-top: 8px; }
  .create .input { width: auto; min-height: 30px; padding: 2px 8px; font-size: 14px; }
  .created { justify-content: space-between; }
  .token { display: block; margin-top: 4px; word-break: break-all; }
</style>
