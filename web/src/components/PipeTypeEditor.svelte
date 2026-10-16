<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { PALETTE, STATUSES, moved } from "../lib/constants";
  import type { PipeType, Status } from "../lib/types";
  import Modal from "./Modal.svelte";
  import Icon, { iconOf } from "./Icon.svelte";
  import IconPicker from "./IconPicker.svelte";
  import { t, tn } from "../lib/i18n.svelte";

  /** `editing`: a custom type to change; otherwise a new type, starting from `base` if given. */
  let { editing = null, base = null, onclose, onsaved }: {
    editing?: PipeType | null;
    base?: PipeType | null;
    onclose: () => void;
    onsaved: () => void;
  } = $props();

  type DraftColumn = { id?: string; key: number; label: string; status: Status; color: string };
  let key = 0;

  // Labels of a built-in type come in the current language: a copy keeps them in that language.
  function fromType(src: PipeType | null, copy: boolean) {
    return {
      label: src ? (copy ? t("{name} (copy)", { name: src.label }) : src.label) : "",
      group: src?.custom ? src.group : "",
      // A new model starts private; its author makes it public when ready.
      visibility: copy || !src ? ("private" as const) : (src.visibility ?? "public"),
      description: src?.description ?? "",
      icon: src?.icon ?? "pipe",
      color: src?.color ?? PALETTE[4],
      columns: (src?.columns ?? [
        { id: "", label: t("To do"), status: "backlog" as Status, color: "#66778F" },
        { id: "", label: t("In progress"), status: "ongoing" as Status, color: "#0366d6" },
        { id: "", label: t("Done"), status: "done" as Status, color: "#3ad984" },
      ]).map((c): DraftColumn => ({ ...c, id: c.id || undefined, key: key++ })),
      taskTypes: [...(src?.taskTypes ?? [])],
      confidential: Boolean(src?.confidential),
      teamOnly: Boolean(src?.teamOnly),
      templates: (src?.templates ?? []).join("\n"),
    };
  }

  let draft = $state(untrack(() => fromType(editing ?? base, !editing && Boolean(base))));
  let baseId = $state(untrack(() => base?.id ?? ""));
  let busy = $state(false);
  let error = $state("");

  const choosable = $derived(app.pipeTypes.filter((pt) => app.usable(pt)));
  const groups = $derived([...new Set(choosable.map((pt) => pt.group))]);
  // Others' private task types stay listed only if this type already offers them.
  const offered = $derived(app.taskTypes.filter((tt) => tt.id !== "task" && (app.usable(tt) || draft.taskTypes.includes(tt.id))));

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
      templates: draft.templates.split("\n").map((line) => line.trim()).filter(Boolean),
    };
    try {
      if (editing) await api.put(`/catalog/pipe-types/${editing.id}`, body);
      else await api.post(`/catalog/pipe-types`, body);
      app.toast(editing ? t("Pipe type saved") : t("Pipe type created"));
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
    <span class="label-text">{t("Visibility of the model")}</span>
    <div class="radio-cards">
      <button type="button" class="radio-card" class:selected={draft.visibility === "private"} onclick={() => (draft.visibility = "private")}>
        <strong><Icon name="lock" size={16} />{t("Private")}</strong><span>{t("Only you can use it and see it in Models")}</span>
      </button>
      <button type="button" class="radio-card" class:selected={draft.visibility === "public"} onclick={() => (draft.visibility = "public")}>
        <strong><Icon name="globe" size={16} />{t("Public")}</strong><span>{t("Offered to everyone, who can also duplicate it")}</span>
      </button>
    </div>
  </div>
{/snippet}

<Modal large {onclose}>
  <form class="editor" onsubmit={submit}>
    <div class="modal-title">{editing ? t("Edit “{name}”", { name: editing.label }) : t("New pipe type")}</div>

    {#if !editing}
      <div class="field">
        <label for="pte-base">{t("Start from")}</label>
        <select id="pte-base" class="input" value={baseId} onchange={(e) => startFrom((e.currentTarget as HTMLSelectElement).value)}>
          <option value="">{t("A blank type")}</option>
          {#each groups as g (g)}
            <optgroup label={g}>
              {#each choosable.filter((pt) => pt.group === g) as pt (pt.id)}<option value={pt.id}>{pt.label}</option>{/each}
            </optgroup>
          {/each}
        </select>
        <div class="hint">{t("The chosen type is copied: you can change everything, the original stays as it is.")}</div>
      </div>
    {/if}

    <div class="grid2">
      <div class="field">
        <label for="pte-name">{t("Name, icon and colour")}</label>
        <div class="row">
          <IconPicker icon={draft.icon} color={draft.color} kind="general"
            onchange={(next) => { draft.icon = next.icon ?? "pipe"; draft.color = next.color ?? draft.color; }} />
          <input id="pte-name" class="input" bind:value={draft.label} required maxlength="60" placeholder={t("E.g.: Work-study")} />
        </div>
      </div>
      <div class="field">
        <label for="pte-group">{t("Category")}</label>
        <input id="pte-group" class="input" bind:value={draft.group} maxlength="40" list="pte-groups" placeholder={t("Custom models")} />
        <datalist id="pte-groups">{#each groups as g (g)}<option value={g}></option>{/each}</datalist>
      </div>
    </div>
    {@render visibilityField()}
    <div class="field">
      <label for="pte-desc">{t("Description")}</label>
      <input id="pte-desc" class="input" bind:value={draft.description} maxlength="500" placeholder={t("What is this type of pipe for?")} />
    </div>

    <div class="field">
      <span class="label-text">{t("Columns")}</span>
      <div class="hint top">
        {t("The state tells how the column counts in the app (tasks in progress, blocked, done…). At least one “Done” column is needed.")}
      </div>
      <div class="rows">
        {#each draft.columns as c, i (c.key)}
          <div class="col-row">
            <label class="dot" style="background:{c.color}" title={t("Colour")}>
              <input type="color" bind:value={c.color} />
            </label>
            <input class="input" bind:value={c.label} required maxlength="40" placeholder={t("Column name")} />
            <select class="input status" bind:value={c.status} title={t("State")}>
              {#each STATUSES as s (s.id)}<option value={s.id}>{t(s.label)}</option>{/each}
            </select>
            <button type="button" class="btn ghost icon small" title={t("Move up")} disabled={i === 0}
              onclick={() => (draft.columns = moved(draft.columns, i, -1))}><span class="up"><Icon name="chevron" size={14} /></span></button>
            <button type="button" class="btn ghost icon small" title={t("Move down")} disabled={i === draft.columns.length - 1}
              onclick={() => (draft.columns = moved(draft.columns, i, 1))}><span class="down"><Icon name="chevron" size={14} /></span></button>
            <button type="button" class="btn ghost icon small" title={t("Remove")} disabled={draft.columns.length <= 2}
              onclick={() => (draft.columns = draft.columns.filter((x) => x !== c))}><Icon name="trash" size={14} /></button>
          </div>
        {/each}
      </div>
      <button type="button" class="btn ghost small" disabled={draft.columns.length >= 15} onclick={addColumn}>
        <Icon name="plus" size={16} />{t("Add a column")}
      </button>
      {#if removedColumns.length}
        <div class="hint warn">
          {tn(removedColumns.length, "Removed column: {names}. Its tasks will go to the column closest to their state.", "Removed columns: {names}. Their tasks will go to the column closest to their state.", { names: removedColumns.map((c) => c.label).join(", ") })}
        </div>
      {/if}
      <div class="board-preview">
        {#each draft.columns as c (c.key)}
          <div class="pcol" style="border-top-color:{c.color}">{c.label || "…"}</div>
        {/each}
      </div>
    </div>

    <div class="field">
      <span class="label-text">{t("Offered task types")}</span>
      <div class="hint top">{t("The plain task is always offered.")}</div>
      <div class="chips">
        {#each offered as tt (tt.id)}
          <button type="button" class="chip" class:selected={draft.taskTypes.includes(tt.id)} title={tt.description}
            onclick={() => toggleTaskType(tt.id)}><Icon name={iconOf(tt.icon)} size={14} />{tt.label}</button>
        {/each}
      </div>
    </div>

    <div class="field">
      <span class="label-text">{t("Confidentiality")}</span>
      <label class="check"><input type="checkbox" bind:checked={draft.confidential} disabled={draft.teamOnly} />
        {t("Confidential: pipes of this type always stay private")}</label>
      <label class="check"><input type="checkbox" bind:checked={draft.teamOnly} />
        {t("Reserved to a team: only in a team space, tasks cannot leave it")}</label>
    </div>

    <div class="field">
      <label for="pte-templates">{t("Starter tasks (one per line)")}</label>
      <textarea id="pte-templates" class="input" bind:value={draft.templates} rows="4"
        placeholder={t("Offered when a pipe is created, in the first column")}></textarea>
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
