<script lang="ts">
  import { onMount } from "svelte";
  import Modal from "./Modal.svelte";
  import Avatar from "./Avatar.svelte";
  import { app } from "../lib/app.svelte";
  import { api, errorMessage } from "../lib/api";
  import { STATUSES } from "../lib/constants";
  import { highlight } from "../lib/search";
  import type { SearchResult } from "../lib/types";
  import { t } from "../lib/i18n.svelte";

  let { onclose }: { onclose: () => void } = $props();

  let q = $state("");
  let status = $state("");
  let owner = $state("");
  let type = $state("");
  let results = $state<SearchResult[]>([]);
  let searched = $state(false);
  let error = $state("");
  let active = $state(0);
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLElement>();

  const myId = $derived(app.me?.user.id);
  const others = $derived(app.users.filter((u) => u.id !== myId).sort((a, b) => a.name.localeCompare(b.name)));
  const taskTypes = $derived([...app.taskTypes].sort((a, b) => a.label.localeCompare(b.label)));

  onMount(() => input?.focus());

  // Searches as one types, a moment after the last key; an older answer arriving late is ignored.
  let seq = 0;
  $effect(() => {
    const text = q.trim();
    const params = new URLSearchParams({ q: text });
    if (status) params.set("status", status);
    if (owner) params.set("owner", owner);
    if (type) params.set("type", type);
    const n = ++seq;
    if (!text) {
      results = [];
      searched = false;
      error = "";
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const found = await api.get<SearchResult[]>(`/search?${params}`);
        if (n !== seq) return;
        results = found;
        error = "";
      } catch (err) {
        if (n !== seq) return;
        results = [];
        error = errorMessage(err);
      }
      searched = true;
      active = 0;
    }, 200);
    return () => clearTimeout(timer);
  });

  function open(r: SearchResult) {
    onclose();
    app.openTask(r.id);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!results.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length;
      list?.querySelectorAll("li")[active]?.scrollIntoView?.({ block: "nearest" });
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      open(results[active]);
    }
  }

  const path = (r: SearchResult) =>
    [r.space.name, r.pipe ? r.pipe.name : t("Incoming"), r.column].filter(Boolean).join(" › ");
</script>

<Modal title={t("Search")} {onclose} large>
  <div class="search">
    <input bind:this={input} class="input" type="search" bind:value={q} {onkeydown} placeholder={t("Search tasks…")}
      aria-label={t("Search tasks…")} aria-controls="search-results" autocomplete="off" />
    <div class="filters">
      <select class="input" bind:value={status} aria-label={t("Status")}>
        <option value="">{t("Any status")}</option>
        <option value="open">{t("Not finished")}</option>
        {#each STATUSES as s (s.id)}<option value={s.id}>{t(s.label)}</option>{/each}
      </select>
      <select class="input" bind:value={owner} aria-label={t("Owner")}>
        <option value="">{t("Any owner")}</option>
        {#if myId}<option value={myId}>{t("Me")}</option>{/if}
        {#each others as u (u.id)}<option value={u.id}>{u.name}</option>{/each}
      </select>
      <select class="input" bind:value={type} aria-label={t("Task type")}>
        <option value="">{t("Any task type")}</option>
        {#each taskTypes as tt (tt.id)}<option value={tt.id}>{tt.label}</option>{/each}
      </select>
    </div>

    {#if error}
      <p class="error-text" role="alert">{error}</p>
    {:else if searched && !results.length}
      <p class="muted">{t("No task found")}</p>
    {/if}
    {#if results.length}
      <ul class="results" id="search-results" role="listbox" aria-label={t("Search")} bind:this={list}>
        {#each results as r, i (r.id)}
          <li role="option" aria-selected={i === active}>
            <button class="result" class:active={i === active} onclick={() => open(r)} onmouseenter={() => (active = i)}>
              <span class="line">
                <span class="key">{r.key}</span>
                <span class="title">{r.title}</span>
                {#if r.pipe?.archived}<span class="badge">{t("Archived")}</span>{/if}
                {#if r.confidential}<span class="badge">{t("Confidential")}</span>{/if}
                {#if r.owner}<Avatar user={r.owner} size={20} />{/if}
              </span>
              <span class="path">{path(r)}</span>
              {#if r.snippet}
                <span class="snippet">{#each highlight(r.snippet) as part, j (j)}{#if part.mark}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
      <p class="hint muted">{t("↑ ↓ to move, Enter to open")}</p>
    {/if}
  </div>
</Modal>

<style>
  .search { display: flex; flex-direction: column; gap: 12px; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; }
  .filters select { flex: 1 1 160px; width: auto; }
  .results { list-style: none; margin: 0; padding: 0; max-height: 60vh; overflow-y: auto; }
  .result {
    display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: 8px 10px;
    border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; cursor: pointer;
  }
  .result.active { background: var(--background-secondary); }
  .line { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .key { color: var(--text-tertiary); font-size: 13px; white-space: nowrap; }
  .title { font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .path { color: var(--text-secondary); font-size: 13px; }
  .snippet { color: var(--text-secondary); font-size: 13px; overflow-wrap: anywhere; }
  .snippet mark { background: rgb(255 214 0 / 35%); color: inherit; border-radius: 2px; }
  .hint { font-size: 12px; margin: 0; }
</style>
