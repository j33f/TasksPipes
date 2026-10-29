<script lang="ts">
  import { onMount } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { router } from "../lib/router.svelte";
  import Icon from "../components/Icon.svelte";
  import { LOCALES, prefs, t, type Locale } from "../lib/i18n.svelte";

  let cfg = $state<{ oauth: boolean; apiKey: boolean; outlineUrl: string | null; mail: boolean; signup: boolean; oidc: { name: string } | null } | null>(null);

  // Outline servers typed here, remembered in this browser. With OAuth set up, the instance's server is used without
  // asking; the others stay a click away for API key sign-in.
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

  let servers = $state<string[]>(readList());
  let selected = $state(readSelected());
  let adding = $state(false);
  let newServer = $state("");
  let serverError = $state("");

  let otherServer = $state(false);
  const typed = $derived(servers.includes(selected) ? selected : (servers[0] ?? ""));
  const instanceServer = $derived(cfg?.oauth && !otherServer ? cfg.outlineUrl : null);
  const server = $derived(instanceServer ?? typed);
  // With no server yet, the address is typed straight away.
  const typing = $derived(adding || !servers.length);
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
    if (!url) return (serverError = t("Invalid address"));
    if (!servers.includes(url)) {
      servers = [...servers, url];
      store("tp:outlineServers", JSON.stringify(servers));
    }
    select(url);
    newServer = "";
    serverError = "";
    adding = false;
  }

  function removeServer(url: string) {
    servers = servers.filter((u) => u !== url);
    store("tp:outlineServers", JSON.stringify(servers));
    if (selected === url) select(servers[0] ?? "");
  }

  let token = $state("");
  let email = $state("");
  let name = $state("");
  /** E-mail part: ask for a sign-in link, or create an account. */
  let mode = $state<"link" | "signup">("link");
  let emailSent = $state(false);
  let busy = $state(false);
  let error = $state(router.params.get("error") ?? "");

  onMount(async () => {
    cfg = await api.get("/auth/config");
    // Kept on another server picked last time.
    otherServer = Boolean(cfg?.oauth && cfg.apiKey && servers.includes(selected) && selected !== cfg.outlineUrl);
  });

  async function askLink(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      await api.post(mode === "signup" ? "/auth/signup" : "/auth/email", mode === "signup" ? { email, name } : { email });
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
    <h1>{t("Sign in to TasksPipes")}</h1>
    <p class="muted">{cfg && !cfg.apiKey && !cfg.oauth ? t("Use your e-mail address.") : t("Use your Outline account, or your e-mail address.")}</p>

    {#if error}<div class="callout danger">{error}</div>{/if}

    {#if cfg?.oidc}
      <a class="btn full" href="/auth/oidc">{t("Continue with {provider}", { provider: cfg.oidc.name })}</a>
      <div class="divider-text">{t("or")}</div>
    {/if}

    {#if (cfg?.apiKey || cfg?.oauth) && !instanceServer}
      <div class="field">
        <label for="server">{t("Outline server")}</label>
        {#if servers.length}
          <div class="row">
            <select id="server" class="input" value={typed}
              onchange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value;
                if (v === "+") { adding = true; (e.currentTarget as HTMLSelectElement).value = typed; } else select(v);
              }}>
              {#each servers as url (url)}<option value={url}>{hostOf(url)}</option>{/each}
              <option value="+">{t("Add a server…")}</option>
            </select>
            <button type="button" class="btn ghost icon" title={t("Remove this server from the list")} onclick={() => removeServer(typed)}>
              <Icon name="close" size={18} />
            </button>
          </div>
        {/if}
        {#if typing}
          <form class="row add-server" onsubmit={addServer}>
            <!-- svelte-ignore a11y_autofocus -->
            <input id={servers.length ? undefined : "server"} class="input" placeholder="https://outline.example.com" bind:value={newServer}
              autofocus={servers.length > 0} aria-label={t("Server address")} />
            <button class="btn neutral" disabled={!newServer.trim()}>{servers.length ? t("Add") : t("OK")}</button>
            {#if servers.length}
              <button type="button" class="btn ghost" onclick={() => { adding = false; serverError = ""; }}>{t("Cancel")}</button>
            {/if}
          </form>
          {#if serverError}<div class="error-text">{serverError}</div>{/if}
          {#if !servers.length}<div class="hint">{t("The address of your Outline workspace, e.g. https://docs.example.com")}</div>{/if}
        {/if}
        {#if cfg?.oauth && cfg.outlineUrl}
          <p class="switch small">
            <button class="link" onclick={() => (otherServer = false)}>{t("Back to {server}", { server: hostOf(cfg.outlineUrl) })}</button>
          </p>
        {/if}
      </div>
    {/if}

    {#if server}
      {#if cfg?.oauth && server === cfg.outlineUrl}
        <a class="btn full" href="/auth/outline">{t("Continue with Outline")}</a>
        {#if cfg.apiKey}<div class="divider-text">{t("or")}</div>{/if}
      {/if}

      {#if cfg?.apiKey}
        <form onsubmit={submit}>
          <div class="field">
            <label for="token">{t("Outline API key")}</label>
            <input id="token" class="input" type="password" autocomplete="off" placeholder="ol_api_…" bind:value={token} required />
            <div class="hint">
              {t("Create one in")} <a href={`${server}/settings/api-and-apps`} target="_blank" rel="noreferrer">{hostOf(server)} › {t("Settings › API")}</a>.
            </div>
          </div>
          <button class="btn full" class:neutral={cfg.oauth && server === cfg.outlineUrl} disabled={busy || !token.trim()}>{t("Sign in with an API key")}</button>
        </form>
        {#if instanceServer}
          <p class="switch small">
            <button class="link" onclick={() => (otherServer = true)}>{t("Another Outline server?")}</button>
          </p>
        {/if}
      {/if}
    {/if}

    {#if cfg?.mail}
      <div class="divider-text">{t("without Outline")}</div>
      {#if emailSent}
        <div class="callout info">
          {mode === "signup"
            ? t("Check your inbox: a link to confirm your address and sign in was sent to {email}.", { email })
            : t("If an account matches {email}, a sign-in link was just sent to it. It is valid for 20 minutes.", { email })}
        </div>
        <button class="btn ghost full" onclick={() => (emailSent = false)}>{t("Use another address")}</button>
      {:else}
        <form onsubmit={askLink}>
          {#if mode === "signup"}
            <div class="field">
              <label for="name">{t("Display name")}</label>
              <input id="name" class="input" autocomplete="name" bind:value={name} required maxlength="120" />
            </div>
          {/if}
          <div class="field">
            <label for="email">{t("E-mail address")}</label>
            <input id="email" class="input" type="email" autocomplete="email" bind:value={email} required />
          </div>
          <button class="btn full neutral" disabled={busy || !email.trim() || (mode === "signup" && !name.trim())}>
            {mode === "signup" ? t("Create my account") : t("Get a sign-in link")}
          </button>
        </form>
        {#if cfg.signup}
          <p class="switch small">
            {#if mode === "link"}
              {t("No account yet?")} <button class="link" onclick={() => (mode = "signup")}>{t("Create an account")}</button>
            {:else}
              {t("Already have an account?")} <button class="link" onclick={() => (mode = "link")}>{t("Get a sign-in link")}</button>
            {/if}
          </p>
        {/if}
      {/if}
    {/if}

    <div class="lang">
      <select class="input" aria-label={t("Language")} value={prefs.locale ?? ""}
        onchange={(e) => prefs.set({ locale: ((e.currentTarget as HTMLSelectElement).value || null) as Locale | null })}>
        <option value="">{t("Language of the browser")}</option>
        {#each LOCALES as l (l.id)}<option value={l.id}>{l.label}</option>{/each}
      </select>
    </div>
  </div>
</div>

<style>
  .login { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .login-box { width: 100%; max-width: 380px; }
  h1 { font-size: 28px; margin: 16px 0 6px; }
  .add-server { margin-top: 8px; }
  .add-server:first-child { margin-top: 0; }
  .add-server .input { flex: 1; min-width: 0; }
  .full { width: 100%; height: 40px; font-size: 15px; }
  .switch { text-align: center; margin: 12px 0 0; color: var(--text-tertiary); }
  .link { border: 0; background: none; padding: 0; font: inherit; color: var(--link); cursor: pointer; }
  .lang { margin-top: 28px; display: flex; justify-content: center; }
  .lang .input { width: auto; min-height: 30px; font-size: 13px; padding: 2px 8px; }
  .divider-text { display: flex; align-items: center; gap: 12px; color: var(--text-tertiary); font-size: 13px; margin: 20px 0; }
  .divider-text::before, .divider-text::after { content: ""; flex: 1; border-top: 1px solid var(--divider); }
</style>
