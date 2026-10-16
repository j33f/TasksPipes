<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import Modal from "./Modal.svelte";
  import Icon from "./Icon.svelte";

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
        app.toast(r.created ? `Invitation envoyée à ${email}` : `${email} a déjà un compte : un lien de connexion lui a été envoyé`);
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
      app.toast("Lien copié");
    } catch {
      app.toast("Copie impossible : sélectionnez le lien", "error");
    }
  }
</script>

<Modal title="Inviter par e-mail" {onclose}>
  {#if link}
    <div class="callout warning">
      <Icon name="mail" />
      <span>L'envoi d'e-mails n'est pas configuré. Transmettez vous-même ce lien à <strong>{email}</strong> : il le ou la connecte directement, une seule fois, pendant 7 jours.</span>
    </div>
    <input class="input" readonly value={link} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
    <div class="modal-actions">
      <button class="btn neutral" onclick={copy}>Copier le lien</button>
      <button class="btn" onclick={onclose}>Terminé</button>
    </div>
  {:else}
    <form onsubmit={submit}>
      <p class="muted small intro">
        La personne reçoit un lien pour se connecter, sans compte Outline. Elle ne voit que vous (et les personnes qu'elle invite) ;
        les autres comptes ne la voient pas, sauf dans les équipes où vous l'ajoutez.
      </p>
      <div class="field">
        <label for="inv-email">Adresse e-mail</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="inv-email" class="input" type="email" bind:value={email} required autofocus />
      </div>
      <div class="field">
        <label for="inv-name">Nom (facultatif)</label>
        <input id="inv-name" class="input" bind:value={name} maxlength="120" placeholder="Prénom Nom" />
      </div>
      {#if adminTeams.length}
        <div class="field">
          <label for="inv-team">Ajouter à une équipe (facultatif)</label>
          <select id="inv-team" class="input" bind:value={teamId}>
            <option value="">Aucune</option>
            {#each adminTeams as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
          </select>
        </div>
      {/if}
      {#if error}<div class="error-text">{error}</div>{/if}
      <div class="modal-actions">
        <button type="button" class="btn neutral" onclick={onclose}>Annuler</button>
        <button class="btn" disabled={busy || !email.trim()}>Inviter</button>
      </div>
    </form>
  {/if}
</Modal>

<style>
  .intro { margin: 0 0 16px; line-height: 1.45; }
</style>
