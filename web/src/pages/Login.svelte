<script lang="ts">
  import { onMount } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { router } from "../lib/router.svelte";
  import Icon from "../components/Icon.svelte";

  let cfg = $state<{ oauth: boolean; apiKey: boolean; outlineUrl: string; mail: boolean } | null>(null);
  let email = $state("");

  // Outline servers: the configured one, plus those added here; remembered in this browser.
  const readList = (): string[] => {
    try {
      const v = JSON.parse(localStorage.getItem("tp:outlineServers") || "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  const readSelected = () => { try { return localStorage.getItem("tp:outlineServer") || ""; } catch { return ""; } };
  const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

  let added = $state<string[]>(readList());
  let selected = $state(readSelected());
  let adding = $state(false);
  let newServer = $state("");
  let serverError = $state("");

  const servers = $derived(cfg ? [cfg.outlineUrl, ...added.filter((u) => u !== cfg!.outlineUrl)] : added);
  const server = $derived(servers.includes(selected) ? selected : (cfg?.outlineUrl ?? ""));
  const isDefaultServer = $derived(server === cfg?.outlineUrl);
  const hostOf = (url: string) => url.replace(/^https?:\/\//, "");

  function select(url: string) {
    selected = url;
    store("tp:outlineServer", url);
  }

  /** Same canonical form as the server: https by default, no trailing slash, no query. */
  function canonical(input: string): string | null {
    try {
      const raw = input.trim();
      const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      return null;
    }
  }

  function addServer(e: SubmitEvent) {
    e.preventDefault();
    const url = canonical(newServer);
    if (!url) return (serverError = "Adresse invalide");
    if (!servers.includes(url)) {
      added = [...added, url];
      store("tp:outlineServers", JSON.stringify(added));
    }
    select(url);
    newServer = "";
    serverError = "";
    adding = false;
  }

  function removeServer(url: string) {
    added = added.filter((u) => u !== url);
    store("tp:outlineServers", JSON.stringify(added));
    if (selected === url) select(cfg?.outlineUrl ?? "");
  }
  let emailSent = $state(false);
  let token = $state("");
  let busy = $state(false);
  let error = $state(router.params.get("error") ?? "");

  onMount(async () => {
    cfg = await api.get("/auth/config");
  });

  async function askLink(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      await api.post("/auth/email", { email });
      emailSent = true;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      await api.post("/auth/apikey", { token, outlineUrl: server });
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
    <p class="muted">Utilisez votre compte Outline, ou votre adresse e-mail si vous avez été invité·e.</p>

    {#if error}<div class="callout danger">{error}</div>{/if}

    {#if cfg}
      <div class="field">
        <label for="server">Serveur Outline</label>
        <div class="row">
          <select id="server" class="input" value={server}
            onchange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              if (v === "+") { adding = true; (e.currentTarget as HTMLSelectElement).value = server; } else select(v);
            }}>
            {#each servers as url (url)}<option value={url}>{hostOf(url)}</option>{/each}
            <option value="+">Ajouter un serveur…</option>
          </select>
          {#if !isDefaultServer}
            <button type="button" class="btn ghost icon" title="Retirer ce serveur de la liste" onclick={() => removeServer(server)}>
              <Icon name="close" size={18} />
            </button>
          {/if}
        </div>
        {#if adding}
          <form class="row add-server" onsubmit={addServer}>
            <!-- svelte-ignore a11y_autofocus -->
            <input class="input" placeholder="https://outline.exemple.fr" bind:value={newServer} autofocus aria-label="Adresse du serveur" />
            <button class="btn neutral" disabled={!newServer.trim()}>Ajouter</button>
            <button type="button" class="btn ghost" onclick={() => { adding = false; serverError = ""; }}>Annuler</button>
          </form>
          {#if serverError}<div class="error-text">{serverError}</div>{/if}
        {/if}
      </div>
    {/if}

    {#if cfg?.oauth && isDefaultServer}
      <a class="btn full" href="/auth/outline">Continuer avec Outline</a>
    {/if}

    {#if cfg?.oauth && isDefaultServer && cfg?.apiKey}<div class="divider-text">ou</div>{/if}

    {#if cfg?.apiKey}
      <form onsubmit={submit}>
        <div class="field">
          <label for="token">Clé API Outline</label>
          <input id="token" class="input" type="password" autocomplete="off" placeholder="ol_api_…" bind:value={token} required />
          <div class="hint">
            À créer dans <a href={`${server}/settings/api-and-apps`} target="_blank" rel="noreferrer">{hostOf(server)} › Paramètres › API</a>.
          </div>
        </div>
        <button class="btn full" class:neutral={cfg.oauth && isDefaultServer} disabled={busy || !token.trim()}>Se connecter avec une clé API</button>
      </form>
    {/if}

    {#if cfg}
      <div class="divider-text">invité·e par e-mail ?</div>
      {#if emailSent}
        <div class="callout info">
          Si un compte invité correspond à <strong>{email}</strong>, un lien de connexion vient de lui être envoyé.
          Il est valable 20 minutes.
        </div>
        <button class="btn ghost full" onclick={() => (emailSent = false)}>Utiliser une autre adresse</button>
      {:else}
        <form onsubmit={askLink}>
          <div class="field">
            <label for="email">Adresse e-mail</label>
            <input id="email" class="input" type="email" autocomplete="email" bind:value={email} required />
          </div>
          <button class="btn full neutral" disabled={busy || !email.trim()}>Recevoir un lien de connexion</button>
        </form>
      {/if}
    {/if}
  </div>
</div>

<style>
  .login { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .login-box { width: 100%; max-width: 380px; }
  h1 { font-size: 28px; margin: 16px 0 6px; }
  .add-server { margin-top: 8px; }
  .add-server .input { flex: 1; min-width: 0; }
  .full { width: 100%; height: 40px; font-size: 15px; }
  .divider-text { display: flex; align-items: center; gap: 12px; color: var(--text-tertiary); font-size: 13px; margin: 20px 0; }
  .divider-text::before, .divider-text::after { content: ""; flex: 1; border-top: 1px solid var(--divider); }
</style>
