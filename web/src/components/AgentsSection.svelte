<script lang="ts">
  /**
   * Agent tokens: for an AI assistant (Claude, Cursor…) acting for oneself over MCP (server: mcp.ts). Shown when an
   * administrator turned AI agents on. An agent always reads; the rest is chosen here, as are the spaces it reaches, and
   * can be changed later without connecting it again (its next request has the new permissions).
   */
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { formatDate, relativeTime } from "../lib/constants";
  import Icon from "./Icon.svelte";
  import type { AccessToken, McpScope } from "../lib/types";
  import { t } from "../lib/i18n.svelte";

  let agents = $state<AccessToken[]>([]);
  let name = $state("");
  /** What an agent may do besides reading, and where: a new one's, or the one being changed. */
  type Choice = { scopes: McpScope[]; everywhere: boolean; chosen: string[] };
  const choice = $state<Choice>({ scopes: [], everywhere: true, chosen: [] });
  /** The agent whose permissions are being changed, and its new choice. */
  let editing = $state<{ id: string; choice: Choice } | null>(null);
  /** The permissions, in the order they are shown. */
  const PERMISSIONS: { scope: McpScope; label: () => string }[] = [
    { scope: "tasks:write", label: () => t("Create and change tasks") },
    { scope: "comments:write", label: () => t("Comment") },
    { scope: "time:write", label: () => t("Log my time") },
    { scope: "tasks:send", label: () => t("Send tasks to other people") },
    { scope: "pipes:write", label: () => t("Create and move pipes in my spaces") },
    { scope: "models:write", label: () => t("Create and change my models (pipe and task types)") },
    { scope: "tasks:delete", label: () => t("Delete, as I could: sub-tasks, time entries, files, my models") },
  ];
  /** Adds or removes a value of a choice's list (a snippet's parameter cannot be bound). */
  const toggle = <T,>(list: T[], value: T, on: boolean) => {
    const i = list.indexOf(value);
    if (on && i < 0) list.push(value);
    if (!on && i >= 0) list.splice(i, 1);
  };
  const asked = (c: Choice) => ({ scopes: PERMISSIONS.map((p) => p.scope).filter((s) => c.scopes.includes(s)), ...(c.everywhere ? { spaceIds: null } : { spaceIds: c.chosen }) });
  /** null: never expires. */
  let days = $state<number | null>(30);
  let created = $state<string | null>(null);
  let error = $state("");

  const endpoint = `${location.origin}/mcp`;
  /** The spaces one may give an agent: one's own and one's teams. */
  const spaces = $derived([...(app.personalSpace ? [app.personalSpace] : []), ...app.myTeams]);
  const spaceName = (id: string) => (id === app.me?.personalSpaceId ? t("My space") : spaces.find((s) => s.id === id)?.name ?? t("A space"));
  const command = $derived(created ? `claude mcp add --transport http taskspipes ${endpoint} --header "Authorization: Bearer ${created}"` : "");

  const load = () =>
    api.get<AccessToken[]>("/me/tokens").then((r) => (agents = r.filter((x) => x.kind === "agent"))).catch((err) => (error = errorMessage(err)));
  load();

  async function create(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    const { scopes, spaceIds } = asked(choice);
    try {
      const r = await api.post<{ token: string }>("/me/tokens", { name, kind: "agent", scopes, days, ...(spaceIds ? { spaceIds } : {}) });
      created = r.token;
      // Tasks can now be handed to it ("me (MCP)").
      app.refreshMe().catch(() => {});
      name = "";
      await load();
    } catch (err) {
      error = errorMessage(err);
    }
  }

  const edit = (tk: AccessToken) =>
    (editing = { id: tk.id, choice: { scopes: tk.scopes.filter((s) => s !== "tasks:read"), everywhere: !tk.spaceIds, chosen: [...(tk.spaceIds ?? [])] } });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!editing) return;
    try {
      await api.patch(`/me/tokens/${editing.id}`, asked(editing.choice));
      editing = null;
      app.toast(t("Saved: the agent has these permissions from its next request"));
      await load();
    } catch (err) {
      app.toast(errorMessage(err), "error");
    }
  }

  async function revoke(tk: AccessToken) {
    if (!confirm(t("Disconnect the agent “{name}”? It can no longer reach your tasks.", { name: tk.name }))) return;
    await api.del(`/me/tokens/${tk.id}`).then(() => { load(); app.refreshMe().catch(() => {}); }).catch((err) => app.toast(errorMessage(err), "error"));
  }

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => app.toast(t("Copied"))).catch(() => {});
</script>

{#snippet permissions(c: Choice)}
  <fieldset>
    <legend class="small">{t("Besides reading, it may:")}</legend>
    {#each PERMISSIONS as p (p.scope)}
      <label><input type="checkbox" checked={c.scopes.includes(p.scope)} onchange={(e) => toggle(c.scopes, p.scope, e.currentTarget.checked)} /> {p.label()}</label>
    {/each}
  </fieldset>
  <fieldset>
    <legend class="small">{t("Spaces it may reach:")}</legend>
    <label><input type="radio" checked={c.everywhere} onchange={() => (c.everywhere = true)} /> {t("All my spaces")}</label>
    <label><input type="radio" checked={!c.everywhere} onchange={() => (c.everywhere = false)} /> {t("Only these:")}</label>
    {#if !c.everywhere}
      <div class="spaces">
        {#each spaces as s (s.id)}
          <label><input type="checkbox" checked={c.chosen.includes(s.id)} onchange={(e) => toggle(c.chosen, s.id, e.currentTarget.checked)} /> {spaceName(s.id)}</label>
        {/each}
      </div>
    {/if}
  </fieldset>
{/snippet}

<div class="section">
  <div class="section-title"><Icon name="lock" />{t("AI agents (MCP)")}</div>
  <p class="small">
    {t("Let an AI assistant (Claude, Cursor…) work on your tasks for you. It acts with your rights, only where you allow it, and never sees confidential pipes. What it does shows in the history as done via it.")}
  </p>
  <p class="small">{t("MCP address:")} <code>{endpoint}</code></p>

  {#if created}
    <div class="callout created" role="status">
      <div class="grow">
        <strong>{t("Copy this token now: it will not be shown again.")}</strong>
        <code class="token">{created}</code>
        <p class="small">{t("With Claude Code, for example:")}</p>
        <code class="token">{command}</code>
      </div>
      <div class="col">
        <button class="btn small" onclick={() => copy(created!)}>{t("Copy")}</button>
        <button class="btn small neutral" onclick={() => copy(command)}>{t("Copy the command")}</button>
      </div>
    </div>
  {/if}

  {#each agents as tk (tk.id)}
    <div class="row token-row">
      <span class="grow">
        <strong>{tk.name}</strong>
        {#if tk.oauth}<span class="badge">{t("Connected with OAuth")}</span>{:else}<code>{tk.prefix}…</code>{/if}
        <span class="badge">{t("Reads")}</span>
        {#if tk.scopes.includes("tasks:write")}<span class="badge">{t("Creates and changes tasks")}</span>{/if}
        {#if tk.scopes.includes("comments:write")}<span class="badge">{t("Comments")}</span>{/if}
        {#if tk.scopes.includes("time:write")}<span class="badge">{t("Logs time")}</span>{/if}
        {#if tk.scopes.includes("tasks:send")}<span class="badge warn">{t("Sends tasks to others")}</span>{/if}
        {#if tk.scopes.includes("pipes:write")}<span class="badge">{t("Creates pipes")}</span>{/if}
        {#if tk.scopes.includes("models:write")}<span class="badge">{t("Makes models")}</span>{/if}
        {#if tk.scopes.includes("tasks:delete")}<span class="badge warn">{t("Deletes")}</span>{/if}
        <span class="small muted">
          {tk.spaceIds ? tk.spaceIds.map(spaceName).join(", ") : t("All my spaces")}
          · {tk.expired ? t("expired") : tk.expiresAt ? t("expires on {date}", { date: formatDate(tk.expiresAt) }) : t("never expires")}
          · {tk.lastUsedAt ? t("used {when}", { when: relativeTime(tk.lastUsedAt) }) : t("never used")}
        </span>
      </span>
      {#if !tk.expired}<button class="btn ghost small" onclick={() => (editing?.id === tk.id ? (editing = null) : edit(tk))}>{t("Change")}</button>{/if}
      <button class="btn ghost small" onclick={() => revoke(tk)}>{t("Disconnect")}</button>
    </div>
    {#if editing?.id === tk.id}
      <form class="create edit" onsubmit={save}>
        {@render permissions(editing.choice)}
        <p class="small muted">{t("No need to connect it again: it has these permissions from its next request.")}</p>
        <div class="row">
          <button class="btn small" disabled={!editing.choice.everywhere && !editing.choice.chosen.length}>{t("Save")}</button>
          <button type="button" class="btn ghost small" onclick={() => (editing = null)}>{t("Cancel")}</button>
        </div>
      </form>
    {/if}
  {/each}

  <form class="create" onsubmit={create}>
    <input class="input" placeholder={t("Agent name (e.g. Claude)")} aria-label={t("Agent name")} bind:value={name} maxlength="100" />
    {@render permissions(choice)}
    <div class="row">
      <select class="input" bind:value={days} aria-label={t("Valid for")}>
        <option value={7}>{t("7 days")}</option>
        <option value={30}>{t("30 days")}</option>
        <option value={90}>{t("90 days")}</option>
        <option value={null}>{t("Never expires")}</option>
      </select>
      <button class="btn small" disabled={!name.trim() || (!choice.everywhere && !choice.chosen.length)}>{t("Connect an agent")}</button>
    </div>
  </form>
  {#if error}<p class="error-text">{error}</p>{/if}
</div>

<style>
  .section { margin-top: 24px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .grow { flex: 1; min-width: 0; }
  .col { display: flex; flex-direction: column; gap: 6px; }
  .token-row { padding: 6px 0; border-top: 1px solid var(--divider); }
  .create.edit { margin: 0 0 8px; padding: 8px 10px; border-radius: 6px; background: var(--background-secondary); }
  .create { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
  .create .input { width: auto; min-height: 30px; padding: 2px 8px; font-size: 14px; }
  fieldset { border: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; }
  legend { width: 100%; margin-bottom: 2px; }
  label { font-size: 14px; }
  .spaces { width: 100%; display: flex; flex-wrap: wrap; gap: 4px 14px; padding-left: 22px; }
  .created { justify-content: space-between; gap: 10px; }
  .token { display: block; margin-top: 4px; word-break: break-all; }
  .badge.warn { color: var(--warning, var(--text)); }
</style>
