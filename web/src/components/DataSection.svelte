<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { navigate } from "../lib/router.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";

  // Deleting the account (e-mail accounts): warned, then confirmed by a two-factor code or a link sent by e-mail.
  let step = $state<"idle" | "warned" | "totp" | "email">("idle");
  let code = $state("");
  let busy = $state(false);
  let error = $state("");

  async function ask() {
    busy = true;
    error = "";
    try {
      const r = await api.post<{ method: "totp" | "email" }>("/me/delete/request");
      step = r.method;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function confirm(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      await api.post("/me/delete", { code });
      app.me = null;
      app.dialog = null;
      navigate("/login", { replace: true });
      app.toast(t("Your account was deleted"));
    } catch (err) {
      error = errorMessage(err);
      code = "";
    } finally {
      busy = false;
    }
  }
</script>

<div class="section">
  <div class="section-title"><Icon name="archive" />{t("Your data")}</div>
  <p class="small">{t("Download what TasksPipes holds about you: your profile, the tasks you wrote, sent or own, your comments and the files of those tasks, in a zip archive.")}</p>
  <a class="btn neutral small" href="/api/me/export" download>{t("Download my data")}</a>

  <!-- Deleting is confirmed by a link sent to the address: e-mail accounts only. -->
  {#if app.me?.user.kind === "email"}
    <div class="delete">
      {#if error}<p class="error-text" role="alert">{error}</p>{/if}
      {#if step === "idle"}
        <button class="btn ghost small danger-text" onclick={() => (step = "warned")}>{t("Delete my account…")}</button>
      {:else if step === "warned"}
        <p class="small">{t("Your account, your personal space and its tasks will be deleted for good. What you did in teams stays in their history, under “Deleted account”; teams you alone administer get a new admin.")}</p>
        <div class="row">
          <button class="btn danger small" disabled={busy} onclick={ask}>{t("Delete my account")}</button>
          <button class="btn ghost small" onclick={() => (step = "idle")}>{t("Cancel")}</button>
        </div>
      {:else if step === "totp"}
        <form class="row" onsubmit={confirm}>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="input code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456"
            bind:value={code} autofocus aria-label={t("Code")} />
          <button class="btn danger small" disabled={busy || code.replace(/\s/g, "").length !== 6}>{t("Delete for good")}</button>
          <button type="button" class="btn ghost small" onclick={() => (step = "idle")}>{t("Cancel")}</button>
        </form>
      {:else}
        <p class="small">{t("We sent you an e-mail: its link deletes your account. It is valid for 30 minutes.")}</p>
      {/if}
    </div>
  {:else if app.me?.user.kind === "oidc"}
    <p class="small muted">{t("Your account comes from your company's sign-in: ask an administrator to disable it.")}</p>
  {:else}
    <p class="small muted">{t("Your account comes from Outline: it cannot be deleted here.")}</p>
  {/if}
</div>

<style>
  .section { margin-top: 24px; }
  .delete { margin-top: 16px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .code { max-width: 140px; font-variant-numeric: tabular-nums; letter-spacing: 0.1em; }
  .danger-text { color: var(--danger); }
</style>
