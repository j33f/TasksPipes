<script lang="ts">
  // The AI assistant on a task: asks the server for a proposal (title, description, fields), shows it next to what
  // is there, and applies only what the person keeps. Nothing changes until "Apply".
  import { onMount } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { TaskDetail, TaskType } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";
  import Modal from "./Modal.svelte";

  let { task, type, onclose, ondone }: { task: TaskDetail; type: TaskType | undefined; onclose: () => void; ondone: () => void } = $props();

  interface Proposal {
    title?: string;
    description?: string;
    fields?: Record<string, unknown>;
    notes?: string;
  }

  let proposal = $state<Proposal | null>(null);
  let error = $state("");
  let busy = $state(true);
  /** What is kept: "title", "description", and field ids. */
  let kept = $state<Record<string, boolean>>({});

  const fieldLabel = (id: string) => type?.fields.find((f) => f.id === id)?.label ?? id;
  const shown = (v: unknown) =>
    v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? t("Yes") : t("No")) : String(v);
  const nothing = $derived(proposal !== null && !proposal.title && !proposal.description && !Object.keys(proposal.fields ?? {}).length);

  async function ask() {
    busy = true;
    error = "";
    proposal = null;
    try {
      const p = await api.post<Proposal>(`/tasks/${task.id}/assist`);
      proposal = p;
      kept = Object.fromEntries([...(p.title ? ["title"] : []), ...(p.description ? ["description"] : []), ...Object.keys(p.fields ?? {})].map((k) => [k, true]));
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
  onMount(ask);

  async function apply(e: SubmitEvent) {
    e.preventDefault();
    if (!proposal) return;
    const body: Record<string, unknown> = {};
    if (proposal.title && kept.title) body.title = proposal.title;
    if (proposal.description && kept.description) body.description = proposal.description;
    const fields = Object.fromEntries(Object.entries(proposal.fields ?? {}).filter(([id]) => kept[id]));
    if (Object.keys(fields).length) body.fields = fields;
    if (!Object.keys(body).length) return onclose();
    busy = true;
    try {
      await api.patch(`/tasks/${task.id}`, body);
      app.toast(t("The assistant's proposal was applied"));
      ondone();
      onclose();
    } catch (err) {
      error = errorMessage(err);
      busy = false;
    }
  }
</script>

<Modal title={t("AI assistant")} large {onclose}>
  <form onsubmit={apply}>
    {#if busy && !proposal}
      <p class="muted thinking"><Icon name="sparkles" size={16} />{t("The assistant reads the task and its comments…")}</p>
    {:else if proposal}
      {#if nothing}
        <p class="muted">{t("The assistant has nothing to change.")}</p>
      {:else}
        <p class="muted small" style="margin-top:0">{t("Tick what to keep. Nothing changes until you apply it.")}</p>
      {/if}
      {#if proposal.title}
        <label class="part">
          <input type="checkbox" bind:checked={kept.title} />
          <span class="grow">
            <span class="label-text">{t("Title")}</span>
            <span class="before">{task.title}</span>
            <span class="after">{proposal.title}</span>
          </span>
        </label>
      {/if}
      {#if proposal.description}
        <label class="part">
          <input type="checkbox" bind:checked={kept.description} />
          <span class="grow">
            <span class="label-text">{t("Description")}</span>
            <span class="cols">
              <span class="box before-box">{#if task.description}<Markdown source={task.description} />{:else}<span class="muted">{t("No description.")}</span>{/if}</span>
              <span class="box after-box"><Markdown source={proposal.description} /></span>
            </span>
          </span>
        </label>
      {/if}
      {#each Object.entries(proposal.fields ?? {}) as [id, value] (id)}
        <label class="part">
          <input type="checkbox" bind:checked={kept[id]} />
          <span class="grow">
            <span class="label-text">{fieldLabel(id)}</span>
            <span class="before">{shown(task.fields?.[id])}</span>
            <span class="after">{shown(value)}</span>
          </span>
        </label>
      {/each}
      {#if proposal.notes}
        <div class="callout info"><Icon name="sparkles" /><div class="grow">{proposal.notes}</div></div>
      {/if}
    {/if}
    {#if error}<div class="error-text" role="alert">{error}</div>{/if}
    <div class="modal-actions">
      <button type="button" class="btn neutral" onclick={onclose}>{t("Cancel")}</button>
      {#if error || (proposal && !busy)}
        <button type="button" class="btn neutral" disabled={busy} onclick={ask}>{t("Ask again")}</button>
      {/if}
      {#if proposal && !nothing}
        <button class="btn" disabled={busy || !Object.values(kept).some(Boolean)}>{t("Apply")}</button>
      {/if}
    </div>
  </form>
</Modal>

<style>
  .thinking { display: flex; gap: 8px; align-items: center; }
  .part { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-top: 1px solid var(--divider); }
  .part input { margin-top: 4px; }
  .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .before { color: var(--text-tertiary); text-decoration: line-through; overflow-wrap: anywhere; }
  .after { overflow-wrap: anywhere; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .box { display: block; max-height: 320px; overflow: auto; padding: 8px; border: 1px solid var(--divider); border-radius: 6px; font-size: 14px; }
  .before-box { color: var(--text-secondary); }
  @media (max-width: 640px) { .cols { grid-template-columns: 1fr; } }
</style>
