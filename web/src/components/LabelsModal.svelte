<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { LABEL_COLORS, labelText } from "../lib/labels";
  import type { Label } from "../lib/types";
  import Modal from "./Modal.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";

  /** The labels of a space, managed by its members. */
  let { spaceId, onclose }: { spaceId: string; onclose: () => void } = $props();

  let labels = $state<Label[]>([]);
  let name = $state("");
  let color = $state(LABEL_COLORS[0]);
  let error = $state("");
  let busy = $state(false);

  const load = () => api.get<Label[]>(`/spaces/${spaceId}/labels`).then((l) => (labels = l)).catch((err) => (error = errorMessage(err)));
  $effect(() => {
    load();
  });

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    error = "";
    try {
      await fn();
      await load();
      app.refresh();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  function add(e: SubmitEvent) {
    e.preventDefault();
    run(async () => {
      await api.post(`/spaces/${spaceId}/labels`, { name, color });
      name = "";
      color = LABEL_COLORS[(LABEL_COLORS.indexOf(color) + 1) % LABEL_COLORS.length];
    });
  }

  const rename = (l: Label, value: string) => value.trim() && value !== l.name && run(() => api.patch(`/labels/${l.id}`, { name: value }));
  const recolor = (l: Label, value: string) => run(() => api.patch(`/labels/${l.id}`, { color: value }));
  const remove = (l: Label) =>
    confirm(t("Delete the label “{name}”? It is taken off its tasks.", { name: l.name })) && run(() => api.del(`/labels/${l.id}`));
</script>

<Modal title={t("Labels")} {onclose}>
  <p class="muted small">{t("Labels of this space, for its tasks. Its members manage them.")}</p>
  <ul class="labels">
    {#each labels as l (l.id)}
      <li>
        <input type="color" value={l.color} aria-label={t("Color of “{name}”", { name: l.name })}
          onchange={(e) => recolor(l, (e.currentTarget as HTMLInputElement).value)} />
        <input class="input" value={l.name} maxlength="40" aria-label={t("Name of “{name}”", { name: l.name })}
          onblur={(e) => rename(l, (e.currentTarget as HTMLInputElement).value)}
          onkeydown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
        <span class="chip" style="background:{l.color};color:{labelText(l.color)}">{l.name}</span>
        <button class="btn ghost icon small" title={t("Delete")} disabled={busy} onclick={() => remove(l)}><Icon name="trash" size={16} /></button>
      </li>
    {:else}
      <li class="muted">{t("No label yet.")}</li>
    {/each}
  </ul>
  <form class="add" onsubmit={add}>
    <input type="color" bind:value={color} aria-label={t("Color")} />
    <input class="input" bind:value={name} maxlength="40" placeholder={t("New label")} aria-label={t("New label")} />
    <button class="btn small" disabled={busy || !name.trim()}>{t("Add")}</button>
  </form>
  {#if error}<p class="error-text">{error}</p>{/if}
  <div class="modal-actions"><button class="btn neutral" onclick={onclose}>{t("Close")}</button></div>
</Modal>

<style>
  .labels { list-style: none; padding: 0; margin: 12px 0; display: flex; flex-direction: column; gap: 6px; }
  .labels li, .add { display: flex; align-items: center; gap: 8px; }
  .labels .input, .add .input { flex: 1; min-height: 32px; padding: 4px 8px; font-size: 14px; }
  input[type="color"] { width: 32px; height: 32px; padding: 0; border: 0; background: none; cursor: pointer; }
  .chip { font-size: 11px; line-height: 16px; padding: 0 6px; border-radius: 8px; font-weight: 500; white-space: nowrap; }
</style>
