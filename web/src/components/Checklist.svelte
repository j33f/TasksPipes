<script lang="ts">
  import type { ChecklistItem } from "../lib/types";
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";

  let { items, editable = true, onadd, ontoggle, onrename, ondelete, onmove }: {
    items: ChecklistItem[];
    editable?: boolean;
    onadd: (text: string) => void | Promise<unknown>;
    ontoggle: (item: ChecklistItem) => void;
    onrename: (item: ChecklistItem, text: string) => void;
    ondelete: (item: ChecklistItem) => void;
    /** New position of a dragged item, between its new neighbours. */
    onmove: (item: ChecklistItem, position: number) => void;
  } = $props();

  let draft = $state("");
  let editingId = $state<string | null>(null);
  let dragId = $state<string | null>(null);
  let overIndex = $state<number | null>(null);

  const doneCount = $derived(items.filter((i) => i.done).length);

  async function add() {
    // Pasting several lines adds one sub-task per line.
    const lines = draft.split("\n").map((l) => l.replace(/^\s*(?:[-*]\s*)?(?:\[[ xX]?\]\s*)?/, "").trim()).filter(Boolean);
    draft = "";
    for (const line of lines) await onadd(line);
  }

  function rename(item: ChecklistItem, e: FocusEvent) {
    const text = (e.currentTarget as HTMLInputElement).value.trim();
    editingId = null;
    if (text && text !== item.text) onrename(item, text);
  }

  function drop(index: number) {
    const item = items.find((i) => i.id === dragId);
    dragId = null;
    overIndex = null;
    if (!item) return;
    const from = items.indexOf(item);
    if (index === from || index === from + 1) return;
    const before = items[index - 1]?.position;
    const after = items[index]?.position;
    const position = before === undefined ? (after ?? 1) - 1 : after === undefined ? before + 1 : (before + after) / 2;
    onmove(item, position);
  }
</script>

<div class="checklist">
  {#if items.length}
    <div class="progress" title={t("{done} of {total}", { done: doneCount, total: items.length })}>
      <div class="bar"><div class="fill" style:width={`${(doneCount / items.length) * 100}%`}></div></div>
      <span class="small muted">{doneCount}/{items.length}</span>
    </div>
  {/if}

  <ul>
    {#each items as item, i (item.id)}
      <li class:done={item.done} class:dragging={dragId === item.id} class:over={overIndex === i}
        draggable={editable && editingId !== item.id}
        ondragstart={(e) => { dragId = item.id; e.dataTransfer!.effectAllowed = "move"; }}
        ondragend={() => { dragId = null; overIndex = null; }}
        ondragover={(e) => { if (dragId) { e.preventDefault(); overIndex = i; } }}
        ondrop={(e) => { e.preventDefault(); drop(i); }}>
        {#if editable}<span class="grip" aria-hidden="true"><Icon name="grip" size={14} /></span>{/if}
        <input type="checkbox" checked={item.done} disabled={!editable} onchange={() => ontoggle(item)}
          aria-label={item.text} />
        {#if editingId === item.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input class="edit" value={item.text} autofocus maxlength="500" onblur={(e) => rename(item, e)}
            onkeydown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
              if (e.key === "Escape") editingId = null;
            }} />
        {:else}
          <span class="text" role="button" tabindex={editable ? 0 : -1} title={item.doneBy ? t("Checked by {name}", { name: item.doneBy }) : undefined}
            ondblclick={() => editable && (editingId = item.id)}
            onkeydown={(e) => editable && e.key === "Enter" && (editingId = item.id)}>{item.text}</span>
        {/if}
        {#if editable}
          <span class="actions">
            <button class="btn ghost icon small" title={t("Rename")} onclick={() => (editingId = item.id)}><Icon name="edit" size={14} /></button>
            <button class="btn ghost icon small" title={t("Delete")} onclick={() => ondelete(item)}><Icon name="trash" size={14} /></button>
          </span>
        {/if}
      </li>
    {/each}
    {#if dragId}
      <li class="drop-end" class:over={overIndex === items.length}
        ondragover={(e) => { e.preventDefault(); overIndex = items.length; }}
        ondrop={(e) => { e.preventDefault(); drop(items.length); }}></li>
    {/if}
  </ul>

  {#if editable}
    <!-- Not a form: the checklist may sit inside the new task form. -->
    <div class="add">
      <Icon name="plus" size={16} />
      <input placeholder={t("Add a sub-task… (Enter)")} bind:value={draft} maxlength="5000"
        onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        onpaste={(e) => {
          const text = e.clipboardData?.getData("text") ?? "";
          if (text.includes("\n")) { e.preventDefault(); draft = text; add(); }
        }} />
    </div>
  {/if}
</div>

<style>
  .progress { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .bar { flex: 1; height: 6px; border-radius: 3px; background: var(--background-secondary); overflow: hidden; }
  .fill { height: 100%; background: #3ad984; transition: width 150ms ease; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; gap: 8px; padding: 3px 4px; border-radius: 6px; font-size: 14px; border-top: 2px solid transparent; }
  li:hover { background: var(--list-hover); }
  li.over { border-top-color: var(--accent); }
  li.dragging { opacity: 0.4; }
  li.drop-end { height: 10px; padding: 0; }
  li.drop-end:hover { background: none; }
  .grip { color: var(--text-tertiary); cursor: grab; opacity: 0; display: flex; }
  li:hover .grip { opacity: 1; }
  input[type="checkbox"] { width: 16px; height: 16px; margin: 0; flex-shrink: 0; accent-color: #3ad984; cursor: pointer; }
  .text { flex: 1; min-width: 0; word-break: break-word; line-height: 1.4; padding: 2px 0; outline: none; }
  li.done .text { text-decoration: line-through; color: var(--text-tertiary); }
  .edit, .add input { flex: 1; font: inherit; font-size: 14px; color: var(--text); border: 0; outline: none; background: none; padding: 2px 0; }
  .edit { border-bottom: 1px solid var(--input-border-focused); }
  .actions { display: flex; opacity: 0; }
  li:hover .actions, li:focus-within .actions { opacity: 1; }
  .add { display: flex; align-items: center; gap: 8px; padding: 4px; color: var(--text-tertiary); }
  @media (hover: none) { .grip, .actions { opacity: 1; } }
</style>
