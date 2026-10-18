<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { formatDate, relativeTime } from "../lib/constants";
  import type { AdminUser } from "../lib/types";
  import { t } from "../lib/i18n.svelte";

  let users = $state<AdminUser[]>([]);
  let filter = $state("");
  let error = $state("");
  let busy = $state<string | null>(null);

  const load = () => api.get<AdminUser[]>("/admin/users").then((u) => (users = u)).catch((err) => (error = errorMessage(err)));
  load();

  const shown = $derived(users.filter((u) => {
    const q = filter.trim().toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
  }));

  async function toggle(u: AdminUser) {
    if (!u.disabled && !confirm(t("Disable the account of {name}? Their sessions are closed at once; their tasks and history stay.", { name: u.name }))) return;
    busy = u.id;
    try {
      await api.post(`/admin/users/${u.id}/${u.disabled ? "enable" : "disable"}`);
      app.toast(u.disabled ? t("Account enabled") : t("Account disabled"));
      await load();
    } catch (err) {
      app.toast(errorMessage(err), "error");
    } finally {
      busy = null;
    }
  }
</script>

<div class="page">
  <h1>{t("Administration")}</h1>
  <p class="muted">{t("Every account of this instance. A disabled account can no longer sign in; its tasks and history stay.")}</p>
  {#if error}<p class="error-text">{error}</p>{/if}
  <input class="input filter" type="search" placeholder={t("Filter by name or e-mail…")} bind:value={filter} aria-label={t("Filter by name or e-mail…")} />
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>{t("Name")}</th><th>{t("Account")}</th><th>{t("Last sign-in")}</th><th>{t("State")}</th><th></th></tr>
      </thead>
      <tbody>
        {#each shown as u (u.id)}
          <tr class:disabled={u.disabled}>
            <td>
              <div class="name">{u.name}{#if u.admin} <span class="badge">{t("Administrator")}</span>{/if}</div>
              <div class="small muted">{u.email ?? "—"}</div>
            </td>
            <td class="small">{u.kind === "outline" ? t("Outline ({server})", { server: u.outlineUrl ?? "" }) : t("E-mail")}</td>
            <td class="small">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : t("never")}</td>
            <td class="small">
              {#if u.disabled}
                {u.disabled.reason === "admin"
                  ? t("Disabled on {date} by {name}", { date: formatDate(u.disabled.at), name: u.disabled.by ?? "—" })
                  : t("Disabled: invitation not used")}
              {:else}{t("Active")}{/if}
            </td>
            <td class="actions">
              {#if !u.admin && u.id !== app.me?.user.id}
                <button class="btn small" class:neutral={!u.disabled} disabled={busy === u.id} onclick={() => toggle(u)}>
                  {u.disabled ? t("Enable") : t("Disable")}
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .filter { max-width: 360px; margin: 16px 0; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-weight: 500; color: var(--text-secondary); padding: 8px; border-bottom: 1px solid var(--divider); }
  td { padding: 8px; border-bottom: 1px solid var(--divider); vertical-align: top; }
  tr.disabled .name { color: var(--text-tertiary); }
  .actions { text-align: right; white-space: nowrap; }
</style>
