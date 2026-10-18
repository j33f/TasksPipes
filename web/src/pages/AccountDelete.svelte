<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { router } from "../lib/router.svelte";
  import { t } from "../lib/i18n.svelte";

  // As for sign-in links: the token is posted on a click, so that mail scanners following the link do not use it.
  const token = router.params.get("token") ?? "";
  let busy = $state(false);
  let error = $state("");
  let done = $state(false);

  async function remove() {
    busy = true;
    error = "";
    try {
      await api.post("/auth/delete-account", { token });
      done = true;
      app.me = null;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="login">
  <div class="login-box">
    <h1>{t("Delete my account")}</h1>
    {#if done}
      <p>{t("Your account was deleted")}</p>
      <p class="small"><a href="/login">{t("Back to the sign-in page")}</a></p>
    {:else}
      <p class="muted">{t("Your account, your personal space and its tasks will be deleted for good. What you did in teams stays in their history, under “Deleted account”; teams you alone administer get a new admin.")}</p>
      {#if error}<div class="callout danger">{error}</div>{/if}
      {#if !token}
        <div class="callout danger">{t("Incomplete link.")}</div>
      {:else}
        <button class="btn danger full" disabled={busy} onclick={remove}>{t("Delete for good")}</button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .login { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .login-box { width: 100%; max-width: 380px; }
  h1 { font-size: 28px; margin: 16px 0 6px; }
  .full { width: 100%; height: 40px; font-size: 15px; margin-top: 8px; }
  .small { margin-top: 16px; }
</style>
