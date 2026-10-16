<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { navigate, router } from "../lib/router.svelte";
  import { t } from "../lib/i18n.svelte";

  // The token is posted on a click, so that mail scanners following the link do not use it up.
  const token = router.params.get("token") ?? "";
  let step = $state<"link" | "totp">("link");
  let code = $state("");
  let busy = $state(false);
  let error = $state("");

  async function done() {
    await app.init();
    navigate("/", { replace: true });
  }

  async function signIn() {
    busy = true;
    error = "";
    try {
      const r = await api.post<{ totp?: boolean }>("/auth/magic", { token });
      if (r.totp) step = "totp";
      else await done();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function verify(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      await api.post("/auth/totp", { code });
      await done();
    } catch (err) {
      error = errorMessage(err);
      code = "";
    } finally {
      busy = false;
    }
  }
</script>

<div class="login">
  <div class="login-box">
    <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="currentColor"/><rect x="7" y="8" width="5" height="16" rx="2" fill="var(--background)"/><rect x="14" y="8" width="5" height="11" rx="2" fill="var(--background)" opacity=".75"/><rect x="21" y="8" width="5" height="7" rx="2" fill="var(--background)" opacity=".5"/></svg>
    {#if step === "link"}
      <h1>{t("Sign in to TasksPipes")}</h1>
      {#if app.me}
        <p class="muted">{t("You are signed in as {name}: continuing will sign you in with the account of this link.", { name: app.me.user.name })}</p>
      {:else}
        <p class="muted">{t("You will be signed in with the account of this link.")}</p>
      {/if}
      {#if error}<div class="callout danger">{error}</div>{/if}
      {#if !token}
        <div class="callout danger">{t("Incomplete link.")}</div>
      {:else}
        <button class="btn full" disabled={busy} onclick={signIn}>{t("Continue")}</button>
      {/if}
      <p class="small"><a href="/login">{t("Ask for a new link")}</a></p>
    {:else}
      <h1>{t("Two-factor authentication")}</h1>
      <p class="muted">{t("Enter the 6-digit code shown by your app (Google Authenticator…).")}</p>
      {#if error}<div class="callout danger">{error}</div>{/if}
      <form onsubmit={verify}>
        <div class="field">
          <!-- svelte-ignore a11y_autofocus -->
          <input class="input code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456"
            bind:value={code} autofocus aria-label={t("Code")} />
        </div>
        <button class="btn full" disabled={busy || code.replace(/\s/g, "").length !== 6}>{t("Confirm")}</button>
      </form>
    {/if}
  </div>
</div>

<style>
  .login { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .login-box { width: 100%; max-width: 380px; }
  h1 { font-size: 28px; margin: 16px 0 6px; }
  .full { width: 100%; height: 40px; font-size: 15px; margin-top: 8px; }
  .code { font-size: 24px; letter-spacing: 0.2em; text-align: center; font-variant-numeric: tabular-nums; }
  .small { margin-top: 16px; }
</style>
