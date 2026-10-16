<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { FIELD_TYPE_LABELS, PIPE_ICONS, moved } from "../lib/constants";
  import type { FieldType, TaskType } from "../lib/types";
  import Modal from "./Modal.svelte";
  import Icon, { iconOf } from "./Icon.svelte";
  import TaskFields from "./TaskFields.svelte";

  /** `editing`: a custom type to change; otherwise a new type, starting from `base` if given. */
  let { editing = null, base = null, onclose, onsaved }: {
    editing?: TaskType | null;
    base?: TaskType | null;
    onclose: () => void;
    onsaved: () => void;
  } = $props();

  type DraftField = { id?: string; key: number; label: string; type: FieldType; options: string; hint: string };
  let key = 0;

  function fromType(t: TaskType | null, copy: boolean) {
    return {
      label: t ? (copy ? `${t.label} (copie)` : t.label) : "",
      description: t?.description ?? "",
      group: t?.custom ? (t.group ?? "") : "",
      visibility: copy || !t ? ("private" as const) : (t.visibility ?? "public"),
      icon: t?.icon ?? "check",
      fields: (t?.fields ?? []).map((f): DraftField => ({
        id: f.id, key: key++, label: f.label, type: f.type, options: (f.options ?? []).join("\n"), hint: f.hint ?? "",
      })),
    };
  }

  let draft = $state(untrack(() => fromType(editing ?? base, !editing && Boolean(base))));
  let baseId = $state(untrack(() => base?.id ?? ""));
  let previewValues = $state<Record<string, unknown>>({});
  let busy = $state(false);
  let error = $state("");

  // A field already saved keeps its type, so that the values entered stay readable.
  const savedField = (id?: string) => (id ? editing?.fields.find((f) => f.id === id) : undefined);
  const hasOptions = (t: FieldType) => t === "select" || t === "multiselect";

  const choosable = $derived(app.taskTypes.filter((t) => app.usable(t)));
  const groups = $derived([...new Set(choosable.map((t) => app.taskTypeGroup(t)))]);

  function startFrom(id: string) {
    baseId = id;
    draft = fromType(app.taskType(id) ?? null, Boolean(id));
  }

  const fieldsOut = $derived(
    draft.fields.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      ...(hasOptions(f.type) ? { options: f.options.split("\n").map((o) => o.trim()).filter(Boolean) } : {}),
      ...(f.hint.trim() ? { hint: f.hint.trim() } : {}),
    }))
  );

  // The preview needs an id for each field, even the new ones.
  const preview = $derived<TaskType>({
    id: "preview", label: draft.label, icon: draft.icon, description: draft.description,
    fields: fieldsOut.map((f, i) => ({ ...f, id: f.id ?? `new${draft.fields[i].key}`, label: f.label || "…" })),
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    const body = {
      label: draft.label, description: draft.description, icon: draft.icon, group: draft.group, visibility: draft.visibility, fields: fieldsOut,
    };
    try {
      if (editing) await api.put(`/catalog/task-types/${editing.id}`, body);
      else await api.post(`/catalog/task-types`, body);
      app.toast(editing ? "Type de tâche enregistré" : "Type de tâche créé");
      await app.loadCatalog();
      onsaved();
      onclose();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Modal large {onclose}>
  <form class="editor" onsubmit={submit}>
    <div class="modal-title">{editing ? `Modifier « ${editing.label} »` : "Nouveau type de tâche"}</div>

    <div class="layout">
      <div>
        {#if !editing}
          <div class="field">
            <label for="tte-base">Partir de</label>
            <select id="tte-base" class="input" value={baseId} onchange={(e) => startFrom((e.currentTarget as HTMLSelectElement).value)}>
              <option value="">Un type vierge</option>
              {#each groups as g (g)}
                <optgroup label={g}>
                  {#each choosable.filter((t) => app.taskTypeGroup(t) === g) as t (t.id)}<option value={t.id}>{t.label}</option>{/each}
                </optgroup>
              {/each}
            </select>
            <div class="hint">Le type choisi est copié avec ses champs ; l'original n'est pas modifié.</div>
          </div>
        {/if}

        <div class="grid2">
          <div class="field">
            <label for="tte-name">Nom</label>
            <input id="tte-name" class="input" bind:value={draft.label} required maxlength="60" placeholder="Ex. : Visite en entreprise" />
          </div>
          <div class="field">
            <label for="tte-group">Catégorie</label>
            <input id="tte-group" class="input" bind:value={draft.group} maxlength="40" list="tte-groups" placeholder="Modèles personnalisés" />
            <datalist id="tte-groups">{#each groups as g (g)}<option value={g}></option>{/each}</datalist>
          </div>
        </div>
        <div class="field">
          <span class="label-text">Visibilité du modèle</span>
          <div class="radio-cards">
            <button type="button" class="radio-card" class:selected={draft.visibility === "private"} onclick={() => (draft.visibility = "private")}>
              <strong><Icon name="lock" size={16} />Privé</strong><span>Vous seul·e pouvez l'utiliser</span>
            </button>
            <button type="button" class="radio-card" class:selected={draft.visibility === "public"} onclick={() => (draft.visibility = "public")}>
              <strong><Icon name="globe" size={16} />Public</strong><span>Proposé à tout le monde</span>
            </button>
          </div>
        </div>
        <div class="field">
          <label for="tte-desc">Description</label>
          <input id="tte-desc" class="input" bind:value={draft.description} maxlength="500" />
        </div>
        <div class="field">
          <span class="label-text">Icône</span>
          <div class="icons">
            {#each PIPE_ICONS as name (name)}
              <button type="button" class="icon-btn" class:selected={draft.icon === name} title={name}
                onclick={() => (draft.icon = name)}><Icon {name} size={18} /></button>
            {/each}
          </div>
        </div>

        <div class="field">
          <span class="label-text">Champs</span>
          <div class="rows">
            {#each draft.fields as f, i (f.key)}
              <div class="field-card">
                <div class="row">
                  <input class="input" bind:value={f.label} required maxlength="80" placeholder="Nom du champ" />
                  <select class="input type" bind:value={f.type} disabled={Boolean(savedField(f.id))}
                    title={savedField(f.id) ? "Le type d'un champ enregistré ne change plus" : "Type"}>
                    {#each Object.entries(FIELD_TYPE_LABELS) as [id, label] (id)}<option value={id}>{label}</option>{/each}
                  </select>
                  <button type="button" class="btn ghost icon small" title="Monter" disabled={i === 0}
                    onclick={() => (draft.fields = moved(draft.fields, i, -1))}><span class="up"><Icon name="chevron" size={14} /></span></button>
                  <button type="button" class="btn ghost icon small" title="Descendre" disabled={i === draft.fields.length - 1}
                    onclick={() => (draft.fields = moved(draft.fields, i, 1))}><span class="down"><Icon name="chevron" size={14} /></span></button>
                  <button type="button" class="btn ghost icon small" title="Retirer"
                    onclick={() => (draft.fields = draft.fields.filter((x) => x !== f))}><Icon name="trash" size={14} /></button>
                </div>
                {#if hasOptions(f.type)}
                  <textarea class="input options" bind:value={f.options} rows="3" placeholder="Un choix par ligne"></textarea>
                {/if}
                <input class="input hint-input" bind:value={f.hint} maxlength="300" placeholder="Aide (facultatif)" />
              </div>
            {/each}
          </div>
          <button type="button" class="btn ghost small" disabled={draft.fields.length >= 40}
            onclick={() => (draft.fields = [...draft.fields, { key: key++, label: "", type: "text", options: "", hint: "" }])}>
            <Icon name="plus" size={16} />Ajouter un champ
          </button>
          {#if editing}
            <div class="hint">Retirer un champ le masque ; les valeurs déjà saisies restent en base.</div>
          {/if}
        </div>
      </div>

      <aside class="preview">
        <div class="section-title"><Icon name={iconOf(draft.icon)} />Aperçu{draft.label ? ` · ${draft.label}` : ""}</div>
        {#if preview.fields.length}
          <TaskFields type={preview} values={previewValues} files={[]}
            onchange={(id, v) => (previewValues = { ...previewValues, [id]: v })} onupload={() => {}} ondeletefile={() => {}} />
        {:else}
          <div class="muted small">Pas encore de champ : les tâches de ce type n'auront que le titre, la description et les sous-tâches.</div>
        {/if}
      </aside>
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
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 0.8fr); gap: 24px; }
  .preview { background: var(--background-secondary); border-radius: 8px; padding: 16px; align-self: start; position: sticky; top: 0; }
  .icons { display: grid; grid-template-columns: repeat(10, 1fr); gap: 2px; }
  .icon-btn { border: 0; background: none; padding: 5px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); }
  .icon-btn:hover { background: var(--list-hover); }
  .icon-btn.selected { background: var(--background-tertiary); color: var(--text); }
  .rows { display: flex; flex-direction: column; gap: 8px; margin-bottom: 6px; }
  .field-card { border: 1px solid var(--divider); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .field-card .input { min-height: 32px; padding: 4px 8px; font-size: 14px; }
  .field-card .type { width: 160px; flex-shrink: 0; }
  .options { min-height: 60px; }
  .hint-input { font-size: 13px !important; }
  .up { display: flex; transform: rotate(-90deg); }
  .down { display: flex; transform: rotate(90deg); }
  @media (max-width: 800px) {
    .editor { padding: 20px 16px; }
    .layout { grid-template-columns: 1fr; }
    .preview { position: static; }
  }
</style>
