<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { formatDate } from "../lib/constants";
  import type { Invitation } from "../lib/types";
  import Modal from "./Modal.svelte";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";
  import InviteModal from "./InviteModal.svelte";

  let { onclose }: { onclose: () => void } = $props();

  const user = $derived(app.me!.user);
  let name = $state(app.me?.user.name ?? "");
  let invitations = $state<Invitation[]>([]);
  let inviting = $state(false);
  let setup = $state<{ secret: string; url: string; qr: string } | null>(null);
  let disabling = $state(false);
  let code = $state("");
  let busy = $state(false);
  let error = $state("");

  const loadInvitations = () => api.get<Invitation[]>("/invitations").then((r) => (invitations = r)).catch(() => {});
  loadInvitations();

  async function run(fn: () => Promise<unknown>, success?: string) {
    busy = true;
    error = "";
    try {
      await fn();
      if (success) app.toast(success);
      await app.init();
      app.refresh();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  function saveName() {
    if (name.trim() && name !== user.name) run(() => api.patch("/me", { name }), "Nom enregistré");
  }

  async function startSetup() {
    busy = true;
    error = "";
    try {
      setup = await api.post("/me/totp/setup");
      code = "";
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function enable(e: SubmitEvent) {
    e.preventDefault();
    await run(() => api.post("/me/totp/enable", { code }), "Double authentification activée");
    if (!error) setup = null;
    code = "";
  }

  async function disable(e: SubmitEvent) {
    e.preventDefault();
    await run(() => api.post("/me/totp/disable", { code }), "Double authentification désactivée");
    if (!error) disabling = false;
    code = "";
  }

  const resend = (i: Invitation) =>
    api
      .post<{ sent: boolean; link?: string }>(`/invitations/${i.id}/resend`)
      .then(async (r) => {
        if (r.sent) app.toast(`Nouveau lien envoyé à ${i.email}`);
        else if (r.link) {
          await navigator.clipboard.writeText(r.link).catch(() => {});
          app.toast("E-mail non configuré : nouveau lien copié, à transmettre vous-même");
        }
      })
      .catch((err) => app.toast(errorMessage(err), "error"));
</script>

<Modal title="Mon compte" {onclose}>
  <div class="profile">
    <Avatar {user} size={48} />
    <div class="grow">
      {#if app.isGuest}
        <input class="input" bind:value={name} maxlength="120" onblur={saveName} aria-label="Nom"
          onkeydown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
      {:else}
        <strong>{user.name}</strong>
      {/if}
      <div class="small muted">{user.email ?? ""} · {app.isGuest ? "compte invité par e-mail" : "compte Outline"}</div>
    </div>
  </div>

  {#if error}<div class="error-text">{error}</div>{/if}

  {#if app.isGuest}
    <div class="section">
      <div class="section-title"><Icon name="shield" />Double authentification</div>
      {#if user.totp}
        <p class="small">
          <span class="ok"><Icon name="check" size={14} />Active.</span>
          À chaque connexion, après le lien reçu par e-mail, le code de votre application est demandé.
        </p>
        {#if disabling}
          <form class="row" onsubmit={disable}>
            <input class="input code" inputmode="numeric" maxlength="7" placeholder="Code actuel" bind:value={code} aria-label="Code" />
            <button class="btn danger small" disabled={busy}>Désactiver</button>
            <button type="button" class="btn ghost small" onclick={() => (disabling = false)}>Annuler</button>
          </form>
        {:else}
          <button class="btn neutral small" onclick={() => (disabling = true)}>Désactiver…</button>
        {/if}
      {:else if setup}
        <ol class="small steps">
          <li>Ouvrez Google Authenticator (ou une application équivalente) et scannez ce code :</li>
        </ol>
        <div class="qr-row">
          <img src={setup.qr} alt="QR code à scanner" width="180" height="180" />
          <div class="small muted">
            Ou saisissez cette clé :
            <code class="secret">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
          </div>
        </div>
        <ol class="small steps" start="2"><li>Saisissez le code à 6 chiffres affiché :</li></ol>
        <form class="row" onsubmit={enable}>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="input code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456"
            bind:value={code} autofocus aria-label="Code" />
          <button class="btn small" disabled={busy || code.replace(/\s/g, "").length !== 6}>Activer</button>
          <button type="button" class="btn ghost small" onclick={() => (setup = null)}>Annuler</button>
        </form>
      {:else}
        <p class="small">Protégez votre compte : en plus du lien reçu par e-mail, un code de votre téléphone sera demandé à chaque connexion.</p>
        <button class="btn small" disabled={busy} onclick={startSetup}>Activer avec Google Authenticator…</button>
      {/if}
    </div>
  {/if}

  <div class="section">
    <div class="section-title">
      <Icon name="mail" />Invitations
      <span class="spacer"></span>
      <button class="btn small neutral" onclick={() => (inviting = true)}><Icon name="plus" size={16} />Inviter par e-mail</button>
    </div>
    {#each invitations as i (i.id)}
      <div class="inv row">
        <div class="grow">
          <strong>{i.name}</strong>
          <div class="small muted">
            {#if i.invitedByMe}
              {i.email} · invité·e le {formatDate(i.createdAt)} · {i.active ? "s'est connecté·e" : "pas encore connecté·e"}
            {:else}
              vous a invité·e le {formatDate(i.createdAt)}
            {/if}
          </div>
        </div>
        {#if i.invitedByMe}<button class="btn ghost small" onclick={() => resend(i)}>Renvoyer un lien</button>{/if}
      </div>
    {:else}
      <div class="small muted">
        Invitez des personnes sans compte Outline (formateurs, partenaires…) : elles se connectent avec un lien reçu par e-mail.
      </div>
    {/each}
  </div>
</Modal>

{#if inviting}<InviteModal onclose={() => (inviting = false)} ondone={loadInvitations} />{/if}

<style>
  .profile { display: flex; align-items: center; gap: 12px; }
  .grow { flex: 1; min-width: 0; }
  .section { margin-top: 24px; }
  .ok { color: #2a9d63; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
  .steps { padding-left: 18px; margin: 4px 0 8px; }
  .qr-row { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; }
  .qr-row img { border-radius: 6px; background: #fff; }
  .secret { display: block; margin-top: 6px; font-size: 14px; word-break: break-all; color: var(--text); }
  .code { max-width: 140px; font-variant-numeric: tabular-nums; letter-spacing: 0.1em; }
  .inv { padding: 8px 0; border-top: 1px solid var(--divider); }
</style>
