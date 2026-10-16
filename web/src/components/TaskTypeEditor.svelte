<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { FIELD_TYPE_LABELS, PIPE_ICONS, moved } from "../lib/constants";
  import type { FieldType, TaskType } from "../lib/types";
  import Modal from "./Modal.svelte";
  import Icon, { iconOf } from "./Icon.svelte";
  import TaskFields from "./TaskFields.svelte";
  import { t } from "../lib/i18n.svelte";

  /** `editing`: a custom type to change; otherwise a new type, starting from `base` if given. */
  let { editing = null, base = null, onclose, onsaved }: {
    editing?: TaskType | null;
    base?: TaskType | null;
    onclose: () => void;
    onsaved: () => void;
  } = $props();

  type DraftField = { id?: string; key: number; label: string; type: FieldType; options: string; hint: string };
  let key = 0;

  // A copy takes the labels as shown (current language), choices included; an edit keeps the stored choices.
  function fromType(src: TaskType | null, copy: boolean) {
    return {
      label: src ? (copy ? t("{name} (copy)", { name: src.label }) : src.label) : "",
      description: src?.description ?? "",
      group: src?.custom ? (src.group ?? "") : "",
      visibility: copy || !src ? ("private" as const) : (src.visibility ?? "public"),
      icon: src?.icon ?? "check",
      fields: (src?.fields ?? []).map((f): DraftField => ({
        id: f.id, key: key++, label: f.label, type: f.type,
        options: ((copy ? f.optionLabels : null) ?? f.options ?? []).join("\n"), hint: f.hint ?? "",
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

  const choosable = $derived(app.taskTypes.filter((tt) => app.usable(tt)));
  const groups = $derived([...new Set(choosable.map((tt) => app.taskTypeGroup(tt)))]);

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
      app.toast(editing ? t("Task type saved") : t("Task type created"));
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
    <div class="modal-title">{editing ? t("Edit “{name}”", { name: editing.label }) : t("New task type")}</div>

    <div class="layout">
      <div>
        {#if !editing}
          <div class="field">
            <label for="tte-base">{t("Start from")}</label>
            <select id="tte-base" class="input" value={baseId} onchange={(e) => startFrom((e.currentTarget as HTMLSelectElement).value)}>
              <option value="">{t("A blank type")}</option>
              {#each groups as g (g)}
                <optgroup label={g}>
                  {#each choosable.filter((tt) => app.taskTypeGroup(tt) === g) as tt (tt.id)}<option value={tt.id}>{tt.label}</option>{/each}
                </optgroup>
              {/each}
            </select>
            <div class="hint">{t("The chosen type is copied with its fields; the original stays as it is.")}</div>
          </div>
        {/if}

        <div class="grid2">
          <div class="field">
            <label for="tte-name">{t("Name")}</label>
            <input id="tte-name" class="input" bind:value={draft.label} required maxlength="60" placeholder={t("E.g.: Company visit")} />
          </div>
          <div class="field">
            <label for="tte-group">{t("Category")}</label>
            <input id="tte-group" class="input" bind:value={draft.group} maxlength="40" list="tte-groups" placeholder={t("Custom models")} />
            <datalist id="tte-groups">{#each groups as g (g)}<option value={g}></option>{/each}</datalist>
          </div>
        </div>
        <div class="field">
          <span class="label-text">{t("Visibility of the model")}</span>
          <div class="radio-cards">
            <button type="button" class="radio-card" class:selected={draft.visibility === "private"} onclick={() => (draft.visibility = "private")}>
              <strong><Icon name="lock" size={16} />{t("Private")}</strong><span>{t("Only you can use it")}</span>
            </button>
            <button type="button" class="radio-card" class:selected={draft.visibility === "public"} onclick={() => (draft.visibility = "public")}>
              <strong><Icon name="globe" size={16} />{t("Public")}</strong><span>{t("Offered to everyone")}</span>
            </button>
          </div>
        </div>
        <div class="field">
          <label for="tte-desc">{t("Description")}</label>
          <input id="tte-desc" class="input" bind:value={draft.description} maxlength="500" />
        </div>
        <div class="field">
          <span class="label-text">{t("Icon")}</span>
          <div class="icons">
            {#each PIPE_ICONS as name (name)}
              <button type="button" class="icon-btn" class:selected={draft.icon === name} title={name}
                onclick={() => (draft.icon = name)}><Icon {name} size={18} /></button>
            {/each}
          </div>
        </div>

        <div class="field">
          <span class="label-text">{t("Fields")}</span>
          <div class="rows">
            {#each draft.fields as f, i (f.key)}
              <div class="field-card">
                <div class="row">
                  <input class="input" bind:value={f.label} required maxlength="80" placeholder={t("Field name")} />
                  <select class="input type" bind:value={f.type} disabled={Boolean(savedField(f.id))}
                    title={savedField(f.id) ? t("The type of a saved field can no longer change") : t("Type")}>
                    {#each Object.entries(FIELD_TYPE_LABELS) as [id, label] (id)}<option value={id}>{t(label)}</option>{/each}
                  </select>
                  <button type="button" class="btn ghost icon small" title={t("Move up")} disabled={i === 0}
                    onclick={() => (draft.fields = moved(draft.fields, i, -1))}><span class="up"><Icon name="chevron" size={14} /></span></button>
                  <button type="button" class="btn ghost icon small" title={t("Move down")} disabled={i === draft.fields.length - 1}
                    onclick={() => (draft.fields = moved(draft.fields, i, 1))}><span class="down"><Icon name="chevron" size={14} /></span></button>
                  <button type="button" class="btn ghost icon small" title={t("Remove")}
                    onclick={() => (draft.fields = draft.fields.filter((x) => x !== f))}><Icon name="trash" size={14} /></button>
                </div>
                {#if hasOptions(f.type)}
                  <textarea class="input options" bind:value={f.options} rows="3" placeholder={t("One choice per line")}></textarea>
                {/if}
                <input class="input hint-input" bind:value={f.hint} maxlength="300" placeholder={t("Help (optional)")} />
              </div>
            {/each}
          </div>
          <button type="button" class="btn ghost small" disabled={draft.fields.length >= 40}
            onclick={() => (draft.fields = [...draft.fields, { key: key++, label: "", type: "text", options: "", hint: "" }])}>
            <Icon name="plus" size={16} />{t("Add a field")}
          </button>
          {#if editing}
            <div class="hint">{t("Removing a field hides it; the values already entered stay in the database.")}</div>
          {/if}
        </div>
      </div>

      <aside class="preview">
        <div class="section-title"><Icon name={iconOf(draft.icon)} />{t("Preview")}{draft.label ? ` · ${draft.label}` : ""}</div>
        {#if preview.fields.length}
          <TaskFields type={preview} values={previewValues} files={[]}
            onchange={(id, v) => (previewValues = { ...previewValues, [id]: v })} onupload={() => {}} ondeletefile={() => {}} />
        {:else}
          <div class="muted small">{t("No field yet: tasks of this type will only have the title, description and sub-tasks.")}</div>
        {/if}
      </aside>
    </div>

    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      <button type="button" class="btn neutral" onclick={onclose}>{t("Cancel")}</button>
      <button class="btn" disabled={busy || !draft.label.trim()}>{editing ? t("Save") : t("Create the type")}</button>
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
