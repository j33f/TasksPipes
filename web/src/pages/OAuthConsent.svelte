<script lang="ts">
  /**
   * Consent to an application signing in to TasksPipes with OAuth to act as an AI agent (server: oauth.ts): who asks,
   * where the answer goes (its host, shown plainly: a lookalike name is the classic trap), what it may do and where.
   * Reached from the application through /oauth/authorize; allowing or refusing sends the browser back to it.
   * Only reading is granted unless the person ticks more: clients tend to ask for every scope the server offers.
   */
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { router } from "../lib/router.svelte";
  import type { McpScope } from "../lib/types";
  import { t } from "../lib/i18n.svelte";
  import { leave } from "../lib/leave";

  interface Pending {
    /** verified: described by a document at its own URL (CIMD); otherwise a name it gave itself (DCR). */
    client: { name: string; verified: boolean; url: string | null; redirectHost: string };
    scopes: McpScope[];
  }

  const id = router.params.get("request") ?? "";
  let request = $state<Pending | null>(null);
  let error = $state("");
  let busy = $state(false);
  let write = $state(false);
  let comment = $state(false);
  let time = $state(false);
  let send = $state(false);
  let remove = $state(false);
  let everywhere = $state(true);
  let chosen = $state<string[]>([]);

  const spaces = $derived([...(app.personalSpace ? [app.personalSpace] : []), ...app.myTeams]);
  const spaceName = (sid: string) => (sid === app.me?.personalSpaceId ? t("My space") : spaces.find((s) => s.id === sid)?.name ?? t("A space"));
  const asked = (s: McpScope) => request?.scopes.includes(s) ?? false;

  if (!id) error = t("Incomplete link.");
  else
    api.get<Pending>(`/oauth/requests/${encodeURIComponent(id)}`)
      .then((r) => (request = r))
      .catch((err) => (error = errorMessage(err)));

  async function answer(allow: boolean) {
    busy = true;
    error = "";
    try {
      const scopes: McpScope[] = [
        ...(write ? (["tasks:write"] as const) : []),
        ...(comment ? (["comments:write"] as const) : []),
        ...(time ? (["time:write"] as const) : []),
        ...(send ? (["tasks:send"] as const) : []),
        ...(remove ? (["tasks:delete"] as const) : []),
      ];
      const r = allow
        ? await api.post<{ redirect: string }>(`/oauth/requests/${encodeURIComponent(id)}/approve`, { scopes, ...(everywhere ? {} : { spaceIds: chosen }) })
        : await api.post<{ redirect: string }>(`/oauth/requests/${encodeURIComponent(id)}/deny`);
      leave(r.redirect);
    } catch (err) {
      error = errorMessage(err);
      busy = false;
    }
  }
</script>

<div class="consent-page">
  <div class="card">
    <header>
      <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="currentColor"/><rect x="7" y="8" width="5" height="16" rx="2" fill="var(--background)"/><rect x="14" y="8" width="5" height="11" rx="2" fill="var(--background)" opacity=".75"/><rect x="21" y="8" width="5" height="7" rx="2" fill="var(--background)" opacity=".5"/></svg>
      <h1>{t("Connect an application")}</h1>
    </header>

    {#if error}<div class="callout danger" role="alert">{error}</div>{/if}

    {#if request}
      <div class="who">
        <p class="lead">
          {t("“{name}” asks to work on your tasks as an AI agent, with your rights.", { name: request.client.name })}
          {#if !request.client.verified}<span class="badge warn" title={t("The application chose this name itself: rely on the address below")}>{t("unverified name")}</span>{/if}
        </p>
        <p class="back">
          <span class="muted small">{t("It will be sent back to:")}</span>
          <strong class="host">{request.client.redirectHost}</strong>
        </p>
        {#if request.client.url}
          <p class="small muted described">{t("Application described at:")} <code>{request.client.url}</code></p>
        {/if}
      </div>

      <fieldset>
        <legend>{t("Besides reading, it may:")}</legend>
        <label><input type="checkbox" bind:checked={write} /> {t("Create and change tasks")}{#if asked("tasks:write")} <span class="asked">{t("asked")}</span>{/if}</label>
        <label><input type="checkbox" bind:checked={comment} /> {t("Comment")}{#if asked("comments:write")} <span class="asked">{t("asked")}</span>{/if}</label>
        <label><input type="checkbox" bind:checked={time} /> {t("Log my time")}{#if asked("time:write")} <span class="asked">{t("asked")}</span>{/if}</label>
        <label><input type="checkbox" bind:checked={send} /> {t("Send tasks to other people")}{#if asked("tasks:send")} <span class="asked">{t("asked")}</span>{/if}</label>
        <label><input type="checkbox" bind:checked={remove} /> {t("Delete, as I could: sub-tasks, time entries, files")}{#if asked("tasks:delete")} <span class="asked">{t("asked")}</span>{/if}</label>
      </fieldset>

      <fieldset>
        <legend>{t("Spaces it may reach:")}</legend>
        <label><input type="radio" bind:group={everywhere} value={true} /> {t("All my spaces")}</label>
        <label><input type="radio" bind:group={everywhere} value={false} /> {t("Only these:")}</label>
        {#if !everywhere}
          <div class="spaces">
            {#each spaces as s (s.id)}
              <label><input type="checkbox" bind:group={chosen} value={s.id} /> {spaceName(s.id)}</label>
            {/each}
          </div>
        {/if}
      </fieldset>

      <p class="small muted note">{t("Only allow it if you started this connection yourself, from an application you trust.")}</p>
      <p class="small muted note">{t("It never sees confidential pipes, and deletes nothing unless you allow it above. You can disconnect it at any time in Settings › AI agents.")}</p>

      <div class="actions">
        <button class="btn neutral" disabled={busy} onclick={() => answer(false)}>{t("Refuse")}</button>
        <button class="btn" disabled={busy || (!everywhere && !chosen.length)} onclick={() => answer(true)}>{t("Allow")}</button>
      </div>
    {:else if !error}
      <p class="muted center">{t("Loading…")}</p>
    {/if}
  </div>
</div>

<style>
  /* Not ".page": the app's page class has a maximum width. */
  .consent-page {
    min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px 16px;
    background: var(--background-secondary);
  }
  .card {
    width: 100%; max-width: 440px; background: var(--card-background); box-shadow: var(--card-shadow);
    border-radius: 12px; padding: 28px 28px 24px;
  }
  header { text-align: center; margin-bottom: 18px; }
  h1 { font-size: 22px; margin: 12px 0 0; }
  .who { background: var(--background-secondary); border-radius: 10px; padding: 14px 16px; margin-bottom: 18px; }
  .lead { margin: 0; line-height: 1.45; }
  .lead .badge { margin-left: 4px; vertical-align: middle; }
  .back { margin: 10px 0 0; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .host { font-size: 17px; word-break: break-all; }
  .described { margin: 6px 0 0; word-break: break-all; }
  fieldset { border: none; padding: 0; margin: 0 0 16px; display: flex; flex-direction: column; gap: 6px; }
  legend { font-weight: 600; font-size: 14px; margin-bottom: 6px; }
  label { font-size: 14px; display: flex; align-items: center; gap: 8px; }
  .asked { font-size: 12px; color: var(--text-tertiary); }
  .spaces { display: flex; flex-direction: column; gap: 6px; padding-left: 26px; }
  .note { margin: 0 0 6px; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 18px; }
  .actions .btn { height: 40px; font-size: 15px; justify-content: center; }
  .center { text-align: center; }
</style>
