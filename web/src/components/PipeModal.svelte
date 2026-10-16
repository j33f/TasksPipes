<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { navigate } from "../lib/router.svelte";
  import { PALETTE, openTaskCount } from "../lib/constants";
  import type { Pipe } from "../lib/types";
  import Modal from "./Modal.svelte";
  import MarkdownEditor from "./MarkdownEditor.svelte";
  import Icon from "./Icon.svelte";
  import IconPicker from "./IconPicker.svelte";

  let { spaceId, pipe = null, onclose }: { spaceId: string; pipe?: Pipe | null; onclose: () => void } = $props();

  const initial = untrack(() => pipe);
  let name = $state(initial?.name ?? "");
  let description = $state(initial?.description ?? "");
  let visibility = $state<"private" | "open">(initial?.visibility ?? "private");
  let kind = $state(initial?.kind ?? "general");
  let color = $state<string | null>(initial?.color ?? app.pipeType("general")?.color ?? PALETTE[4]);
  let icon = $state<string | null>(initial?.icon ?? null);
  let withTemplates = $state(true);
  let busy = $state(false);
  let error = $state("");

  const type = $derived(app.pipeType(kind));
  const openTasks = $derived(pipe ? openTaskCount(pipe.counts) : 0);
  // A private pipe belongs to its space: personal in a personal space, the team's in a team space.
  const isTeam = $derived(app.spaces.find((s) => s.id === spaceId)?.kind === "team");
  const choosable = $derived(app.pipeTypes.filter((t) => app.usable(t) || t.id === initial?.kind));
  const groups = $derived([...new Set(choosable.map((t) => t.group))]);

  function chooseKind(id: string) {
    const previous = app.pipeType(kind);
    kind = id;
    if (app.pipeType(id)?.confidential) visibility = "private";
    // Follow the type's colour unless one was picked by hand.
    if (!color || color === previous?.color) color = app.pipeType(id)?.color ?? color;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const body = { name, description, visibility, kind, color, icon, withTemplates: !pipe && withTemplates };
      if (pipe) {
        await api.patch(`/pipes/${pipe.id}`, body);
        app.toast("Pipe mis à jour");
      } else {
        const { id } = await api.post<{ id: string }>(`/spaces/${spaceId}/pipes`, body);
        navigate(`/pipes/${id}`);
      }
      app.refresh();
      onclose();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function setArchived(archived: boolean) {
    if (!pipe) return;
    try {
      await api.patch(`/pipes/${pipe.id}`, { archived });
      app.toast(archived ? "Pipe archivé" : "Pipe désarchivé");
      app.refresh();
      onclose();
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function remove() {
    if (!pipe || !confirm(`Supprimer le pipe « ${pipe.name} » ?`)) return;
    try {
      await api.del(`/pipes/${pipe.id}`);
      app.refresh();
      onclose();
      navigate(`/spaces/${spaceId}`);
    } catch (err) {
      error = errorMessage(err);
    }
  }
</script>

<Modal title={pipe ? "Modifier le pipe" : "Nouveau pipe"} {onclose}>
  <form onsubmit={submit}>
    <div class="field">
      <label for="pm-kind">Type</label>
      <select id="pm-kind" class="input" value={kind} onchange={(e) => chooseKind((e.currentTarget as HTMLSelectElement).value)}>
        {#each groups as g (g)}
          <optgroup label={g}>
            {#each choosable.filter((t) => t.group === g) as t (t.id)}
              <option value={t.id} disabled={t.teamOnly && !isTeam}>{t.label}{t.teamOnly && !isTeam ? " (espace d'équipe uniquement)" : ""}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      {#if !pipe}
        <div class="hint">Aucun type ne convient ? <a href="/designer" onclick={onclose}>Concevez le vôtre dans Modèles</a>.</div>
      {/if}
      {#if type}
        <div class="hint">{type.description}</div>
        <div class="preview">
          <div class="cols">
            {#each type.columns as c (c.id)}<span class="col"><span class="status-dot" style="background:{c.color}"></span>{c.label}</span>{/each}
          </div>
          {#if type.taskTypes.length}
            <div class="hint">Types de tâches : {type.taskTypes.map((id) => app.taskType(id)?.label ?? id).join(" · ")}</div>
          {/if}
        </div>
        {#if pipe && kind !== pipe.kind}
          <div class="hint warn">Les tâches seront rangées dans les colonnes du nouveau type selon leur état.</div>
        {/if}
      {/if}
      {#if !pipe && type?.templates.length}
        <label class="check">
          <input type="checkbox" bind:checked={withTemplates} />
          Ajouter les {type.templates.length} tâches type au backlog
        </label>
        {#if withTemplates}
          <ul class="templates">{#each type.templates as t (t)}<li>{t}</li>{/each}</ul>
        {/if}
      {/if}
    </div>
    <div class="field">
      <label for="pm-name">Nom, icône et couleur</label>
      <div class="row name-row">
        <IconPicker {icon} {color} {kind} onchange={(next) => { icon = next.icon; color = next.color; }} />
        <!-- svelte-ignore a11y_autofocus -->
        <input id="pm-name" class="input" bind:value={name} required maxlength="120" autofocus
          placeholder={type && type.id !== "general" ? `${type.label}${type.templates.length ? " – session …" : ""}` : ""} />
      </div>
    </div>
    <div class="field">
      <span class="label-text">Description</span>
      <MarkdownEditor bind:value={description} rows={4} />
    </div>
    <div class="field">
      <span class="label-text">Visibilité</span>
      <div class="radio-cards">
        <button type="button" class="radio-card" class:selected={visibility === "private"} onclick={() => (visibility = "private")}>
          {#if isTeam}
            <strong><Icon name="users" size={16} />Équipe</strong>
            <span>Privé : visible uniquement par les membres de l'équipe.</span>
          {:else}
            <strong><Icon name="lock" size={16} />Perso</strong>
            <span>Privé : visible uniquement par vous.</span>
          {/if}
        </button>
        <button type="button" class="radio-card" class:selected={visibility === "open"} disabled={type?.confidential}
          onclick={() => (visibility = "open")}>
          <strong><Icon name="globe" size={16} />Open</strong>
          <span>Public : tout le monde le voit et peut y ajouter des tâches.</span>
        </button>
      </div>
      {#if type?.confidential}
        <div class="hint"><Icon name="lock" size={12} />
          {#if type.teamOnly}Données sensibles : visible uniquement par les membres de l'équipe, et ses tâches ne peuvent pas en sortir.
          {:else}Données personnelles sensibles : ce type de pipe reste privé.{/if}
        </div>
      {/if}
    </div>
    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      {#if pipe && !pipe.isDefault}
        <button type="button" class="btn ghost" onclick={() => setArchived(!pipe.archived)}
          disabled={!pipe.archived && openTasks > 0}
          title={!pipe.archived && openTasks > 0 ? `Encore ${openTasks} tâche(s) en cours : à terminer ou abandonner avant d'archiver` : ""}>
          <Icon name="archive" size={16} />{pipe.archived ? "Désarchiver" : "Archiver"}
        </button>
        <button type="button" class="btn ghost" onclick={remove}><Icon name="trash" size={16} />Supprimer</button>
      {/if}
      <span class="spacer"></span>
      <button type="button" class="btn neutral" onclick={onclose}>Annuler</button>
      <button class="btn" disabled={busy || !name.trim()}>{pipe ? "Enregistrer" : "Créer"}</button>
    </div>
  </form>
</Modal>

<style>
  .name-row { gap: 6px; }
  .name-row .input { flex: 1; }
  .preview { margin-top: 8px; }
  .cols { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; color: var(--text-secondary); }
  .col { display: inline-flex; align-items: center; gap: 4px; }
  .col .status-dot { width: 8px; height: 8px; }
  .warn { color: var(--warning, #f08a24); }
  .radio-card:disabled { opacity: 0.45; cursor: not-allowed; }
  .check { display: flex; align-items: center; gap: 8px; font-size: 14px; margin-top: 10px; cursor: pointer; }
  .templates { margin: 6px 0 0; padding-left: 26px; max-height: 160px; overflow-y: auto; font-size: 13px; color: var(--text-tertiary); }
</style>
