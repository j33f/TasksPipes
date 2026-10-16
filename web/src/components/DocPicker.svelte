<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import type { OutlineDoc } from "../lib/types";
  import Icon from "./Icon.svelte";
  import { app } from "../lib/app.svelte";

  let { onselect, autofocus = false }: { onselect: (doc: OutlineDoc) => void; autofocus?: boolean } = $props();

  let q = $state("");
  let results = $state<OutlineDoc[]>([]);
  let loading = $state(false);
  let error = $state("");
  let open = $state(false);
  let timer: ReturnType<typeof setTimeout>;

  function search() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      loading = true;
      error = "";
      try {
        results = await api.get<OutlineDoc[]>(`/outline/documents?q=${encodeURIComponent(q)}`);
      } catch (err) {
        error = errorMessage(err);
        results = [];
      } finally {
        loading = false;
      }
    }, 250);
  }

  function pick(doc: OutlineDoc) {
    onselect(doc);
    open = false;
    q = "";
  }
</script>

{#if app.isGuest}
  <div class="hint">Outline n'est pas accessible aux comptes invités par e-mail.</div>
{:else}
<div class="picker">
  <!-- svelte-ignore a11y_autofocus -->
  <input class="input" placeholder="Rechercher un document Outline ou coller son URL…" bind:value={q} {autofocus}
    oninput={search} onfocus={() => { open = true; search(); }} onblur={() => setTimeout(() => (open = false), 200)} />
  {#if open}
    <div class="picker-results">
      {#if loading && !results.length}<div class="menu-item muted">Recherche…</div>{/if}
      {#if error}<div class="menu-item error-text">{error}</div>{/if}
      {#if !loading && !error && !results.length}<div class="menu-item muted">Aucun document</div>{/if}
      {#each results as d (d.id)}
        <button class="menu-item" onmousedown={(e) => { e.preventDefault(); pick(d); }}>
          <Icon name="doc" size={16} /><span class="ellipsis">{d.title}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
{/if}

<style>
  .picker { position: relative; }
  .picker-results {
    position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 20;
    background: var(--modal-background); box-shadow: var(--menu-shadow); border-radius: 8px;
    max-height: 280px; overflow-y: auto; padding: 4px;
  }
  .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
