<script lang="ts">
  /**
   * Consent to an application signing in to TasksPipes with OAuth to act as an AI agent (server: oauth.ts): who asks,
   * where the answer goes (its host, shown plainly: a lookalike name is the classic trap), what it may do and where.
   * Reached from the application through /oauth/authorize; allowing or refusing sends the browser back to it.
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
  let everywhere = $state(true);
  let chosen = $state<string[]>([]);

  const spaces = $derived([...(app.personalSpace ? [app.personalSpace] : []), ...app.myTeams]);
  const spaceName = (sid: string) => (sid === app.me?.personalSpaceId ? t("My space") : spaces.find((s) => s.id === sid)?.name ?? t("A space"));

  if (!id) error = t("Incomplete link.");
  else
    api.get<Pending>(`/oauth/requests/${encodeURIComponent(id)}`)
      .then((r) => {
        request = r;
        // What the application asked for is ticked; the person decides.
        write = r.scopes.includes("tasks:write");
        comment = r.scopes.includes("comments:write");
        time = r.scopes.includes("time:write");
        send = r.scopes.includes("tasks:send");
      })
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

<div class="login">
  <div class="login-box consent">
    <h1>{t("Connect an application")}</h1>
    {#if error}<div class="callout danger" role="alert">{error}</div>{/if}
    {#if request}
      <p>
        {t("“{name}” asks to work on your tasks as an AI agent, with your rights.", { name: request.client.name })}
        {#if !request.client.verified}<span class="badge warn" title={t("The application chose this name itself: rely on the address below")}>{t("unverified name")}</span>{/if}
      </p>
      <p class="small">
        {t("It will be sent back to:")} <strong class="host">{request.client.redirectHost}</strong>
        {#if request.client.url}<br />{t("Application described at:")} <code>{request.client.url}</code>{/if}
      </p>
      <p class="small muted">{t("Only allow it if you started this connection yourself, from an application you trust.")}</p>

      <fieldset>
        <legend class="small">{t("Besides reading, it may:")}</legend>
        <label><input type="checkbox" bind:checked={write} /> {t("Create and change tasks")}</label>
        <label><input type="checkbox" bind:checked={comment} /> {t("Comment")}</label>
        <label><input type="checkbox" bind:checked={time} /> {t("Log my time")}</label>
        <label><input type="checkbox" bind:checked={send} /> {t("Send tasks to other people")}</label>
      </fieldset>
      <fieldset>
        <legend class="small">{t("Spaces it may reach:")}</legend>
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
      <p class="small muted">{t("It never sees confidential pipes and deletes nothing. You can disconnect it at any time in Settings › AI agents.")}</p>

      <div class="actions">
        <button class="btn neutral" disabled={busy} onclick={() => answer(false)}>{t("Refuse")}</button>
        <button class="btn" disabled={busy || (!everywhere && !chosen.length)} onclick={() => answer(true)}>{t("Allow")}</button>
      </div>
    {:else if !error}
      <p class="muted">{t("Loading…")}</p>
    {/if}
  </div>
</div>

<style>
  .consent { max-width: 460px; text-align: left; }
  .host { font-size: 16px; }
  fieldset { border: none; padding: 0; margin: 12px 0; display: flex; flex-direction: column; gap: 4px; }
  legend { margin-bottom: 4px; }
  label { font-size: 14px; }
  .spaces { display: flex; flex-direction: column; gap: 4px; padding-left: 22px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
