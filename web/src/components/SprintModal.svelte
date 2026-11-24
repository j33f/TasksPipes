<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "../lib/api";
  import { app } from "../lib/app.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { Sprint } from "../lib/types";
  import Modal from "./Modal.svelte";

  /** A new sprint of the pipe (its dates follow the last one by default), or one to change. */
  let { pipeId, sprint = null, onclose }: { pipeId: string; sprint?: Sprint | null; onclose: () => void } = $props();

  // The form starts from the sprint as it was when opened.
  const initial = untrack(() => sprint);
  const closed = initial?.status === "closed";
  let name = $state(initial?.name ?? "");
  let goal = $state(initial?.goal ?? "");
  let startsOn = $state(initial?.startsOn ?? "");
  let endsOn = $state(initial?.endsOn ?? "");
  let exceptional = $state(initial?.exceptional ?? false);
  let busy = $state(false);
  let error = $state("");

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = "";
    try {
      const body: Record<string, unknown> = { name, goal };
      // Dates left empty for a new sprint: the server picks them after the last one.
      if (!closed && startsOn) body.startsOn = startsOn;
      if (!closed && endsOn) body.endsOn = endsOn;
      if (closed) body.exceptional = exceptional;
      if (sprint) await api.patch(`/sprints/${sprint.id}`, body);
      else await api.post(`/pipes/${pipeId}/sprints`, body);
      app.refresh();
      onclose();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={sprint ? t("Edit the sprint") : t("New sprint")} {onclose}>
  <form onsubmit={submit}>
    <div class="field">
      <label for="sp-name">{t("Name")}</label>
      <input id="sp-name" class="input" bind:value={name} maxlength="120" placeholder={sprint ? "" : t("Sprint {n}", { n: "…" })} />
    </div>
    <div class="field">
      <label for="sp-goal">{t("Sprint goal")}</label>
      <textarea id="sp-goal" class="input" bind:value={goal} rows="3" maxlength="2000" placeholder={t("What the team commits to deliver")}></textarea>
    </div>
    {#if !closed}
      <div class="dates">
        <div class="field">
          <label for="sp-start">{t("Starts on")}</label>
          <input id="sp-start" class="input" type="date" bind:value={startsOn} />
        </div>
        <div class="field">
          <label for="sp-end">{t("Ends on")}</label>
          <input id="sp-end" class="input" type="date" bind:value={endsOn} min={startsOn || undefined} />
        </div>
      </div>
      {#if !sprint}<p class="muted small">{t("Left empty, the dates follow the last sprint, with the length set in the pipe's settings.")}</p>{/if}
    {:else}
      <label class="check"><input type="checkbox" bind:checked={exceptional} />
        {t("Exceptional sprint (holidays, incident…): left out of the learned velocity")}</label>
    {/if}
    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      <button type="button" class="btn neutral" onclick={onclose}>{t("Cancel")}</button>
      <button class="btn" disabled={busy}>{sprint ? t("Save") : t("Add the sprint")}</button>
    </div>
  </form>
</Modal>

<style>
  .check { display: flex; align-items: center; gap: 8px; font-size: 14px; margin: 6px 0; cursor: pointer; }
  .dates { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  textarea { resize: vertical; }
</style>
