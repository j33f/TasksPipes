<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { PALETTE, STATUSES, moved } from "../lib/constants";
  import type { PipeType, Status } from "../lib/types";
  import Modal from "./Modal.svelte";
  import Icon, { iconOf } from "./Icon.svelte";
  import IconPicker from "./IconPicker.svelte";

  /** `editing`: a custom type to change; otherwise a new type, starting from `base` if given. */
  let { editing = null, base = null, onclose, onsaved }: {
    editing?: PipeType | null;
    base?: PipeType | null;
    onclose: () => void;
    onsaved: () => void;
  } = $props();

  type DraftColumn = { id?: string; key: number; label: string; status: Status; color: string };
  let key = 0;

  function fromType(t: PipeType | null, copy: boolean) {
    return {
      label: t ? (copy ? `${t.label} (copie)` : t.label) : "",
      group: t?.custom ? t.group : "",
      // A new model starts private; its author makes it public when ready.
      visibility: copy || !t ? ("private" as const) : (t.visibility ?? "public"),
      description: t?.description ?? "",
      icon: t?.icon ?? "pipe",
      color: t?.color ?? PALETTE[4],
      columns: (t?.columns ?? [
        { id: "", label: "À faire", status: "backlog" as Status, color: "#66778F" },
        { id: "", label: "En cours", status: "ongoing" as Status, color: "#0366d6" },
        { id: "", label: "Terminé", status: "done" as Status, color: "#3ad984" },
      ]).map((c): DraftColumn => ({ ...c, id: c.id || undefined, key: key++ })),
      taskTypes: [...(t?.taskTypes ?? [])],
      confidential: Boolean(t?.confidential),
      teamOnly: Boolean(t?.teamOnly),
      templates: (t?.templates ?? []).join("\n"),
    };
  }

  let draft = $state(untrack(() => fromType(editing ?? base, !editing && Boolean(base))));
  let baseId = $state(untrack(() => base?.id ?? ""));
  let busy = $state(false);
  let error = $state("");

  const choosable = $derived(app.pipeTypes.filter((t) => app.usable(t)));
  const groups = $derived([...new Set(choosable.map((t) => t.group))]);
  // Others' private task types stay listed only if this type already offers them.
  const offered = $derived(app.taskTypes.filter((t) => t.id !== "task" && (app.usable(t) || draft.taskTypes.includes(t.id))));

  function startFrom(id: string) {
    baseId = id;
    draft = fromType(app.pipeType(id) ?? null, Boolean(id));
  }

  function addColumn() {
    const color = PALETTE[draft.columns.length % PALETTE.length];
    draft.columns = [...draft.columns, { key: key++, label: "", status: "ongoing", color }];
  }

  function toggleTaskType(id: string) {
    draft.taskTypes = draft.taskTypes.includes(id) ? draft.taskTypes.filter((x) => x !== id) : [...draft.taskTypes, id];
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    const body = {
      ...draft,
      columns: draft.columns.map(({ id, label, status, color }) => ({ id, label, status, color })),
      templates: draft.templates.split("\n").map((t) => t.trim()).filter(Boolean),
    };
    try {
      if (editing) await api.put(`/catalog/pipe-types/${editing.id}`, body);
      else await api.post(`/catalog/pipe-types`, body);
      app.toast(editing ? "Type de pipe enregistré" : "Type de pipe créé");
      await app.loadCatalog();
      onsaved();
      onclose();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  const removedColumns = $derived(
    editing ? editing.columns.filter((c) => !draft.columns.some((d) => d.id === c.id)) : []
  );
</script>

{#snippet visibilityField()}
  <div class="field">
    <span class="label-text">Visibilité du modèle</span>
    <div class="radio-cards">
      <button type="button" class="radio-card" class:selected={draft.visibility === "private"} onclick={() => (draft.visibility = "private")}>
        <strong><Icon name="lock" size={16} />Privé</strong><span>Vous seul·e pouvez l'utiliser et le voir dans Modèles</span>
      </button>
      <button type="button" class="radio-card" class:selected={draft.visibility === "public"} onclick={() => (draft.visibility = "public")}>
        <strong><Icon name="globe" size={16} />Public</strong><span>Proposé à tout le monde, qui peut aussi le dupliquer</span>
      </button>
    </div>
  </div>
{/snippet}

<Modal large {onclose}>
  <form class="editor" onsubmit={submit}>
    <div class="modal-title">{editing ? `Modifier « ${editing.label} »` : "Nouveau type de pipe"}</div>

    {#if !editing}
      <div class="field">
        <label for="pte-base">Partir de</label>
        <select id="pte-base" class="input" value={baseId} onchange={(e) => startFrom((e.currentTarget as HTMLSelectElement).value)}>
          <option value="">Un type vierge</option>
          {#each groups as g (g)}
            <optgroup label={g}>
              {#each choosable.filter((t) => t.group === g) as t (t.id)}<option value={t.id}>{t.label}</option>{/each}
            </optgroup>
          {/each}
        </select>
        <div class="hint">Le type choisi est copié : vous pouvez tout changer, l'original n'est pas modifié.</div>
      </div>
    {/if}

    <div class="grid2">
      <div class="field">
        <label for="pte-name">Nom, icône et couleur</label>
        <div class="row">
          <IconPicker icon={draft.icon} color={draft.color} kind="general"
            onchange={(next) => { draft.icon = next.icon ?? "pipe"; draft.color = next.color ?? draft.color; }} />
          <input id="pte-name" class="input" bind:value={draft.label} required maxlength="60" placeholder="Ex. : Alternance" />
        </div>
      </div>
      <div class="field">
        <label for="pte-group">Catégorie</label>
        <input id="pte-group" class="input" bind:value={draft.group} maxlength="40" list="pte-groups" placeholder="Modèles personnalisés" />
        <datalist id="pte-groups">{#each groups as g (g)}<option value={g}></option>{/each}</datalist>
      </div>
    </div>
    {@render visibilityField()}
    <div class="field">
      <label for="pte-desc">Description</label>
      <input id="pte-desc" class="input" bind:value={draft.description} maxlength="500" placeholder="À quoi sert ce type de pipe ?" />
    </div>

    <div class="field">
      <span class="label-text">Colonnes</span>
      <div class="hint top">
        L'état dit comment la colonne compte dans l'application (tâches en cours, bloquées, terminées…).
        Il faut au moins une colonne « Terminé ».
      </div>
      <div class="rows">
        {#each draft.columns as c, i (c.key)}
          <div class="col-row">
            <label class="dot" style="background:{c.color}" title="Couleur">
              <input type="color" bind:value={c.color} />
            </label>
            <input class="input" bind:value={c.label} required maxlength="40" placeholder="Nom de la colonne" />
            <select class="input status" bind:value={c.status} title="État">
              {#each STATUSES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
            </select>
            <button type="button" class="btn ghost icon small" title="Monter" disabled={i === 0}
              onclick={() => (draft.columns = moved(draft.columns, i, -1))}><span class="up"><Icon name="chevron" size={14} /></span></button>
            <button type="button" class="btn ghost icon small" title="Descendre" disabled={i === draft.columns.length - 1}
              onclick={() => (draft.columns = moved(draft.columns, i, 1))}><span class="down"><Icon name="chevron" size={14} /></span></button>
            <button type="button" class="btn ghost icon small" title="Retirer" disabled={draft.columns.length <= 2}
              onclick={() => (draft.columns = draft.columns.filter((x) => x !== c))}><Icon name="trash" size={14} /></button>
          </div>
        {/each}
      </div>
      <button type="button" class="btn ghost small" disabled={draft.columns.length >= 15} onclick={addColumn}>
        <Icon name="plus" size={16} />Ajouter une colonne
      </button>
      {#if removedColumns.length}
        <div class="hint warn">
          Colonne{removedColumns.length > 1 ? "s" : ""} retirée{removedColumns.length > 1 ? "s" : ""} :
          {removedColumns.map((c) => c.label).join(", ")}. Leurs tâches iront dans la colonne la plus proche de leur état.
        </div>
      {/if}
      <div class="board-preview">
        {#each draft.columns as c (c.key)}
          <div class="pcol" style="border-top-color:{c.color}">{c.label || "…"}</div>
        {/each}
      </div>
    </div>

    <div class="field">
      <span class="label-text">Types de tâches proposés</span>
      <div class="hint top">La tâche simple est toujours proposée.</div>
      <div class="chips">
        {#each offered as t (t.id)}
          <button type="button" class="chip" class:selected={draft.taskTypes.includes(t.id)} title={t.description}
            onclick={() => toggleTaskType(t.id)}><Icon name={iconOf(t.icon)} size={14} />{t.label}</button>
        {/each}
      </div>
    </div>

    <div class="field">
      <span class="label-text">Confidentialité</span>
      <label class="check"><input type="checkbox" bind:checked={draft.confidential} disabled={draft.teamOnly} />
        Confidentiel : les pipes de ce type restent toujours privés</label>
      <label class="check"><input type="checkbox" bind:checked={draft.teamOnly} />
        Réservé à une équipe : seulement dans un espace d'équipe, les tâches ne peuvent pas en sortir</label>
    </div>

    <div class="field">
      <label for="pte-templates">Tâches de départ (une par ligne)</label>
      <textarea id="pte-templates" class="input" bind:value={draft.templates} rows="4"
        placeholder="Proposées à la création d'un pipe, dans la première colonne"></textarea>
    </div>

    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      <button type="button" class="btn neutral" onclick={onclose}>Annuler</button>
      <button class="btn" disabled={busy || !draft.label.trim()}>{editing ? "Enregistrer" : "Créer le type"}</button>
    </div>
  </form>
</Modal>

<style>
  .editor { padding: 24px 28px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .hint.top { margin: 0 0 8px; }
  .hint.warn { color: var(--warning); }
  .rows { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
  .col-row { display: flex; align-items: center; gap: 6px; }
  .col-row .input { min-height: 32px; padding: 4px 8px; font-size: 14px; }
  .col-row .status { width: 170px; flex-shrink: 0; }
  .dot { width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; position: relative; overflow: hidden; cursor: pointer; }
  .dot input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .up { display: flex; transform: rotate(-90deg); }
  .down { display: flex; transform: rotate(90deg); }
  .board-preview { display: flex; gap: 6px; overflow-x: auto; margin-top: 10px; padding-bottom: 4px; }
  .pcol {
    flex: 0 0 110px; height: 56px; border-radius: 6px; background: var(--background-secondary); border-top: 3px solid;
    font-size: 12px; font-weight: 600; padding: 6px 8px; color: var(--text-secondary); overflow: hidden;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--input-border); border-radius: 14px;
    padding: 3px 10px; background: none; color: var(--text-secondary); font: inherit; font-size: 13px; cursor: pointer;
  }
  .chip.selected { border-color: var(--accent); background: rgb(3 102 214 / 10%); color: var(--text); }
  .check { display: flex; gap: 8px; align-items: center; font-size: 14px; margin: 4px 0; }
  textarea.input { min-height: 90px; }
  @media (max-width: 700px) {
    .editor { padding: 20px 16px; }
    .grid2 { grid-template-columns: 1fr; }
    .col-row .status { width: 120px; }
  }
</style>
