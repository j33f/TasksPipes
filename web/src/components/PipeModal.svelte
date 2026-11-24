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
  import GitIntegrations from "./GitIntegrations.svelte";
  import IncomingWebhook from "./IncomingWebhook.svelte";
  import { intlLocale, t, tn } from "../lib/i18n.svelte";
  import { WEEKDAYS, addDays } from "../lib/sprints";
  import type { SprintSettings } from "../lib/types";

  let { spaceId, pipe = null, onclose }: { spaceId: string; pipe?: Pipe | null; onclose: () => void } = $props();

  const initial = untrack(() => pipe);
  let name = $state(initial?.name ?? "");
  let description = $state(initial?.description ?? "");
  let visibility = $state<"private" | "open">(initial?.visibility ?? "private");
  let kind = $state(initial?.kind ?? "general");
  let color = $state<string | null>(initial?.color ?? app.pipeType("general")?.color ?? PALETTE[4]);
  let icon = $state<string | null>(initial?.icon ?? null);
  let withTemplates = $state(true);
  // How it works in sprints (a pipe whose type does).
  let sprint = $state<SprintSettings>(untrack(() => ({
    weeks: 2, startDay: 1, workDays: [1, 2, 3, 4, 5], velocityMode: "learned", initialVelocity: null, sendReport: false,
    ...(initial?.sprintSettings ?? {}),
  })));
  // 2026-11-30 is a Monday: its week names the days in the reader's language.
  const dayName = (d: number) => new Intl.DateTimeFormat(intlLocale(), { weekday: "long" }).format(new Date(`${addDays("2026-11-30", d - 1)}T12:00:00`));
  function toggleDay(d: number) {
    sprint.workDays = sprint.workDays.includes(d) ? sprint.workDays.filter((x) => x !== d) : [...sprint.workDays, d].sort();
  }
  let busy = $state(false);
  let error = $state("");

  const type = $derived(app.pipeType(kind));
  const openTasks = $derived(pipe ? openTaskCount(pipe.counts) : 0);
  // A private pipe belongs to its space: personal in a personal space, the team's in a team space.
  const isTeam = $derived(app.spaces.find((s) => s.id === spaceId)?.kind === "team");
  const choosable = $derived(app.pipeTypes.filter((pt) => app.offered(pt) || pt.id === initial?.kind));
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
      const body = {
        name, description, visibility, kind, color, icon, withTemplates: !pipe && withTemplates,
        ...(pipe && type?.sprints ? { sprintSettings: sprint } : {}),
      };
      if (pipe) {
        await api.patch(`/pipes/${pipe.id}`, body);
        app.toast(t("Pipe updated"));
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
      app.toast(archived ? t("Pipe archived") : t("Pipe unarchived"));
      app.refresh();
      onclose();
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function remove() {
    if (!pipe || !confirm(t("Delete the pipe “{name}”?", { name: pipe.name }))) return;
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

<Modal title={pipe ? t("Edit the pipe") : t("New pipe")} {onclose}>
  <form onsubmit={submit}>
    <div class="field">
      <label for="pm-kind">{t("Type")}</label>
      <select id="pm-kind" class="input" value={kind} onchange={(e) => chooseKind((e.currentTarget as HTMLSelectElement).value)}>
        {#each groups as g (g)}
          <optgroup label={g}>
            {#each choosable.filter((pt) => pt.group === g) as pt (pt.id)}
              <option value={pt.id} disabled={pt.teamOnly && !isTeam}>{pt.label}{pt.teamOnly && !isTeam ? ` (${t("team space only")})` : ""}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      {#if !pipe}
        <div class="hint">{t("No type fits?")} <a href="/designer" onclick={onclose}>{t("Design your own in Models")}</a>.</div>
      {/if}
      {#if type}
        <div class="hint">{type.description}</div>
        <div class="preview">
          <div class="cols">
            {#each type.columns as c (c.id)}<span class="col"><span class="status-dot" style="background:{c.color}"></span>{c.label}</span>{/each}
          </div>
          {#if type.taskTypes.length}
            <div class="hint">{t("Task types:")} {type.taskTypes.map((id) => app.taskType(id)?.label ?? id).join(" · ")}</div>
          {/if}
        </div>
        {#if pipe && kind !== pipe.kind}
          <div class="hint warn">{t("Tasks will be put in the columns of the new type according to their state.")}</div>
        {/if}
      {/if}
      {#if !pipe && type?.templates.length}
        <label class="check">
          <input type="checkbox" bind:checked={withTemplates} />
          {tn(type.templates.length, "Add the {n} starter task to the first column", "Add the {n} starter tasks to the first column")}
        </label>
        {#if withTemplates}
          <ul class="templates">{#each type.templates as tpl (tpl)}<li>{tpl}</li>{/each}</ul>
        {/if}
      {/if}
    </div>
    <div class="field">
      <label for="pm-name">{t("Name, icon and colour")}</label>
      <div class="row name-row">
        <IconPicker {icon} {color} {kind} onchange={(next) => { icon = next.icon; color = next.color; }} />
        <!-- svelte-ignore a11y_autofocus -->
        <input id="pm-name" class="input" bind:value={name} required maxlength="120" autofocus
          placeholder={type && type.id !== "general" ? `${type.label}${type.templates.length ? ` – ${t("session")} …` : ""}` : ""} />
      </div>
    </div>
    <div class="field">
      <span class="label-text">{t("Description")}</span>
      <MarkdownEditor bind:value={description} rows={4} />
    </div>
    <div class="field">
      <span class="label-text">{t("Visibility")}</span>
      <div class="radio-cards">
        <button type="button" class="radio-card" class:selected={visibility === "private"} onclick={() => (visibility = "private")}>
          {#if isTeam}
            <strong><Icon name="users" size={16} />{t("Team")}</strong>
            <span>{t("Private: only the team's members see it.")}</span>
          {:else}
            <strong><Icon name="lock" size={16} />{t("Personal")}</strong>
            <span>{t("Private: only you see it.")}</span>
          {/if}
        </button>
        <button type="button" class="radio-card" class:selected={visibility === "open"} disabled={type?.confidential}
          onclick={() => (visibility = "open")}>
          <strong><Icon name="globe" size={16} />{t("Open")}</strong>
          <span>{t("Public: everyone sees it and can add tasks to it.")}</span>
        </button>
      </div>
      {#if type?.confidential}
        <div class="hint"><Icon name="lock" size={12} />
          {#if type.teamOnly}{t("Sensitive data: only the team's members see it, and its tasks cannot leave it.")}
          {:else}{t("Sensitive personal data: this type of pipe stays private.")}{/if}
        </div>
      {/if}
    </div>
    {#if pipe && type?.sprints}
      <details class="field git-section">
        <summary class="label-text">{t("Sprints")}</summary>
        <div class="sprint-grid">
          <div class="field">
            <label for="pm-weeks">{t("Length of a sprint")}</label>
            <select id="pm-weeks" class="input" bind:value={sprint.weeks}>
              {#each [1, 2, 3, 4] as w (w)}<option value={w}>{tn(w, "{n} week", "{n} weeks")}</option>{/each}
            </select>
          </div>
          <div class="field">
            <label for="pm-start-day">{t("Starts on a")}</label>
            <select id="pm-start-day" class="input" bind:value={sprint.startDay}>
              {#each WEEKDAYS as d (d)}<option value={d}>{dayName(d)}</option>{/each}
            </select>
          </div>
        </div>
        <fieldset class="field days">
          <legend class="label-text">{t("Working days")}</legend>
          {#each WEEKDAYS as d (d)}
            <label class="day"><input type="checkbox" checked={sprint.workDays.includes(d)} onchange={() => toggleDay(d)} />{dayName(d).slice(0, 3)}</label>
          {/each}
        </fieldset>
        <fieldset class="field">
          <legend class="label-text">{t("Velocity")}</legend>
          <label class="check"><input type="radio" bind:group={sprint.velocityMode} value="learned" />
            {t("Learned from the last sprints (a low average, unusual sprints left out)")}</label>
          <label class="check"><input type="radio" bind:group={sprint.velocityMode} value="manual" />{t("Set by hand")}</label>
          <label class="velocity">
            <span>{sprint.velocityMode === "learned" ? t("Until enough sprints are closed:") : t("Points per sprint:")}</span>
            <input class="input" type="number" min="0" max="10000" step="1" value={sprint.initialVelocity ?? ""}
              oninput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; sprint.initialVelocity = v === "" ? null : Math.max(0, Math.round(Number(v))); }} />
            <span class="muted">{t("pts")}</span>
          </label>
        </fieldset>
        <label class="check"><input type="checkbox" bind:checked={sprint.sendReport} />
          {t("E-mail the report of each closed sprint to the space's members")}</label>
      </details>
    {/if}
    {#if pipe}
      <details class="field git-section">
        <summary class="label-text">{t("GitHub / GitLab")}</summary>
        <GitIntegrations pipeId={pipe.id} />
      </details>
      <details class="field git-section">
        <summary class="label-text">{t("Incoming webhook")}</summary>
        <IncomingWebhook pipeId={pipe.id} />
      </details>
    {/if}
    {#if error}<div class="error-text">{error}</div>{/if}
    <div class="modal-actions">
      {#if pipe && !pipe.isDefault}
        <button type="button" class="btn ghost" onclick={() => setArchived(!pipe.archived)}
          disabled={!pipe.archived && openTasks > 0}
          title={!pipe.archived && openTasks > 0 ? tn(openTasks, "Still {n} open task: finish or drop it before archiving", "Still {n} open tasks: finish or drop them before archiving") : ""}>
          <Icon name="archive" size={16} />{pipe.archived ? t("Unarchive") : t("Archive")}
        </button>
        <button type="button" class="btn ghost" onclick={remove}><Icon name="trash" size={16} />{t("Delete")}</button>
      {/if}
      <span class="spacer"></span>
      <button type="button" class="btn neutral" onclick={onclose}>{t("Cancel")}</button>
      <button class="btn" disabled={busy || !name.trim()}>{pipe ? t("Save") : t("Create")}</button>
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
  .git-section summary { cursor: pointer; }
  .sprint-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
  fieldset { border: 0; padding: 0; margin: 8px 0 0; }
  .days { display: flex; flex-wrap: wrap; gap: 4px 12px; }
  .days legend { width: 100%; margin-bottom: 4px; }
  .day { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; text-transform: capitalize; cursor: pointer; }
  .velocity { display: flex; align-items: center; gap: 8px; font-size: 14px; margin-top: 8px; flex-wrap: wrap; }
  .velocity .input { width: 90px; }
  .templates { margin: 6px 0 0; padding-left: 26px; max-height: 160px; overflow-y: auto; font-size: 13px; color: var(--text-tertiary); }
</style>
