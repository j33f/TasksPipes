<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import Modal from "./Modal.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";

  let { onclose, ondone }: { onclose: () => void; ondone?: () => void } = $props();

  let email = $state("");
  let name = $state("");
  let teamId = $state("");
  let busy = $state(false);
  let error = $state("");
  /** Sign-in link to pass on by hand when e-mail sending is not configured. */
  let link = $state<string | null>(null);

  const adminTeams = $derived(app.myTeams.filter((t) => t.myRole === "admin"));

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      const r = await api.post<{ sent: boolean; link?: string; created: boolean }>("/invitations", { email, name, teamId: teamId || null });
      app.refresh();
      ondone?.();
      if (r.sent) {
        app.toast(r.created ? t("Invitation sent to {email}", { email }) : t("{email} already has an account: a sign-in link was sent to them", { email }));
        onclose();
      } else {
        link = r.link ?? null;
      }
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link!);
      app.toast(t("Link copied"));
    } catch {
      app.toast(t("Could not copy: select the link"), "error");
    }
  }
</script>

<Modal title={t("Invite by e-mail")} {onclose}>
  {#if link}
    <div class="callout warning">
      <Icon name="mail" />
      <span>{t("E-mail sending is not set up. Pass this link on to {email} yourself: it signs them in directly, once, for 7 days.", { email })}</span>
    </div>
    <input class="input" readonly value={link} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
    <div class="modal-actions">
      <button class="btn neutral" onclick={copy}>{t("Copy the link")}</button>
      <button class="btn" onclick={onclose}>{t("Done")}</button>
    </div>
  {:else}
    <form onsubmit={submit}>
      <p class="muted small intro">
        {t("The person gets a link to sign in, without an Outline account. They only see you (and the people they invite); other accounts do not see them, except in the teams you add them to.")}
      </p>
      <div class="field">
        <label for="inv-email">{t("E-mail address")}</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="inv-email" class="input" type="email" bind:value={email} required autofocus />
      </div>
      <div class="field">
        <label for="inv-name">{t("Name (optional)")}</label>
        <input id="inv-name" class="input" bind:value={name} maxlength="120" placeholder={t("First name Last name")} />
      </div>
      {#if adminTeams.length}
        <div class="field">
          <label for="inv-team">{t("Add to a team (optional)")}</label>
          <select id="inv-team" class="input" bind:value={teamId}>
            <option value="">{t("None")}</option>
            {#each adminTeams as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
          </select>
        </div>
      {/if}
      {#if error}<div class="error-text">{error}</div>{/if}
      <div class="modal-actions">
        <button type="button" class="btn neutral" onclick={onclose}>{t("Cancel")}</button>
        <button class="btn" disabled={busy || !email.trim()}>{t("Invite")}</button>
      </div>
    </form>
  {/if}
</Modal>

<style>
  .intro { margin: 0 0 16px; line-height: 1.45; }
</style>
