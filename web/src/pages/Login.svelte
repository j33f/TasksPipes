<script lang="ts">
  import { onMount } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { router } from "../lib/router.svelte";

  let cfg = $state<{ oauth: boolean; apiKey: boolean; outlineUrl: string } | null>(null);
  let token = $state("");
  let busy = $state(false);
  let error = $state(router.params.get("error") ?? "");

  onMount(async () => {
    cfg = await api.get("/auth/config");
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      await api.post("/auth/apikey", { token });
      await app.init();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="login">
  <div class="login-box">
    <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="currentColor"/><rect x="7" y="8" width="5" height="16" rx="2" fill="var(--background)"/><rect x="14" y="8" width="5" height="11" rx="2" fill="var(--background)" opacity=".75"/><rect x="21" y="8" width="5" height="7" rx="2" fill="var(--background)" opacity=".5"/></svg>
    <h1>Connexion à TasksPipes</h1>
    <p class="muted">Utilisez votre compte Outline pour accéder à vos pipes et à ceux de votre équipe.</p>

    {#if error}<div class="callout danger">{error}</div>{/if}

    {#if cfg?.oauth}
      <a class="btn full" href="/auth/outline">Continuer avec Outline</a>
    {/if}

    {#if cfg?.oauth && cfg?.apiKey}<div class="divider-text">ou</div>{/if}

    {#if cfg?.apiKey}
      <form onsubmit={submit}>
        <div class="field">
          <label for="token">Clé API Outline</label>
          <input id="token" class="input" type="password" autocomplete="off" placeholder="ol_api_…" bind:value={token} required />
          <div class="hint">
            À créer dans <a href={`${cfg.outlineUrl}/settings/api-and-apps`} target="_blank" rel="noreferrer">Outline › Paramètres › API</a>.
          </div>
        </div>
        <button class="btn full" class:neutral={cfg.oauth} disabled={busy || !token.trim()}>Se connecter avec une clé API</button>
      </form>
    {/if}
  </div>
</div>

<style>
  .login { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .login-box { width: 100%; max-width: 380px; }
  h1 { font-size: 28px; margin: 16px 0 6px; }
  .full { width: 100%; height: 40px; font-size: 15px; }
  .divider-text { display: flex; align-items: center; gap: 12px; color: var(--text-tertiary); font-size: 13px; margin: 20px 0; }
  .divider-text::before, .divider-text::after { content: ""; flex: 1; border-top: 1px solid var(--divider); }
</style>
